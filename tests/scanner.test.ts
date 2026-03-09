import {describe, test, expect, beforeEach, afterEach} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {DiscoveredSession} from '../src/types.js';
import {extractAssistantResponses, matchSessionBySnippets} from '../src/scanner.js';

function makeDiscovered(overrides: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    sessionId: 'session-1',
    projectDir: 'test-project',
    projectName: 'test-project',
    jsonlFile: '/tmp/test.jsonl',
    modifiedAt: Date.now(),
    createdAt: Date.now(),
    pid: 0,
    processStartedAt: 0,
    ...overrides,
  };
}

function writeAssistantMessage(filePath: string, text: string) {
  const record = JSON.stringify({
    type: 'assistant',
    message: {role: 'assistant', content: [{type: 'text', text}]},
  });
  fs.appendFileSync(filePath, record + '\n');
}

describe('extractAssistantResponses', () => {
  test('extracts snippet from ⏺ text lines', () => {
    const terminal = [
      '❯ fix the bug',
      '⏺ I found the issue in parser.ts line 42 and it needs a type guard',
      '❯ looks good',
      '⏺ Great, the fix has been applied successfully to the codebase',
    ].join('\n');

    const responses = extractAssistantResponses(terminal);
    expect(responses).toEqual([
      'I found the issue in parser.ts',  // 30 chars
      'Great, the fix has been applie',
    ]);
  });

  test('filters out tool-use lines', () => {
    const terminal = [
      '⏺ Bash(ls -la)',
      '⏺ Read 1 file (ctrl+o to expand)',
      '⏺ Edit(src/scanner.ts)',
      '⏺ This is a real text response from the assistant',
      '⏺ Read src/scanner.ts',
      '⏺ Update(src/parser.ts)',
      '⏺ Searched for 2 patterns (ctrl+o to expand)',
      '⏺ Agent(Explore session mapping)',
      '⏺ code-simplifier(Simplify API code changes)',
      '⏺ code-simplifier:code-simplifier(Simplify API code changes)',
      '⏺ superpowers:code-reviewer(Code review API changes)',
      '⏺ Skill(brainstorming)',
      '⏺ Read 6 files (ctrl+o to expand)',
      '⏺ Searched for 1 pattern (ctrl+o to expand)',
    ].join('\n');

    const responses = extractAssistantResponses(terminal);
    expect(responses).toEqual(['This is a real text response f']);
  });

  test('filters out lines with ctrl+o', () => {
    const terminal = '⏺ 3 files changed (ctrl+o to expand)\n⏺ All tests pass now\n';
    const responses = extractAssistantResponses(terminal);
    expect(responses).toEqual(['All tests pass now']);
  });

  test('skips snippets shorter than 10 chars', () => {
    const terminal = '⏺ Done\n⏺ This is long enough to be a valid snippet\n';
    const responses = extractAssistantResponses(terminal);
    expect(responses).toEqual(['This is long enough to be a va']);
  });

  test('handles empty terminal', () => {
    expect(extractAssistantResponses('')).toEqual([]);
  });
});

describe('matchSessionBySnippets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  test('matches session by snippet substring', () => {
    const file = path.join(tmpDir, 'session-a.jsonl');
    writeAssistantMessage(file, 'I found the issue in parser.ts line 42 and fixed it');

    const sessions = [
      makeDiscovered({sessionId: 'session-a', jsonlFile: file}),
    ];

    // Snippet is first 30 chars of the terminal line
    const result = matchSessionBySnippets(['I found the issue in parser.t'], sessions);
    expect(result).toBe('session-a');
  });

  test('returns null when no session matches', () => {
    const file = path.join(tmpDir, 'session-a.jsonl');
    writeAssistantMessage(file, 'unrelated response');

    const sessions = [
      makeDiscovered({sessionId: 'session-a', jsonlFile: file}),
    ];

    const result = matchSessionBySnippets(['something completely different'], sessions);
    expect(result).toBeNull();
  });

  test('picks session with most matches', () => {
    const fileA = path.join(tmpDir, 'session-a.jsonl');
    writeAssistantMessage(fileA, 'Fixed the parser validation logic');

    const fileB = path.join(tmpDir, 'session-b.jsonl');
    writeAssistantMessage(fileB, 'Deployed to production successfully and verified health checks');
    writeAssistantMessage(fileB, 'All health checks are passing now');

    const sessions = [
      makeDiscovered({sessionId: 'session-a', jsonlFile: fileA}),
      makeDiscovered({sessionId: 'session-b', jsonlFile: fileB}),
    ];

    const result = matchSessionBySnippets(
      ['Deployed to production success', 'All health checks are passing'],
      sessions,
    );
    expect(result).toBe('session-b');
  });

  test('matches after /clear (new file has recent responses)', () => {
    const oldFile = path.join(tmpDir, 'old-session.jsonl');
    writeAssistantMessage(oldFile, 'Built the auth system with JWT tokens');

    const newFile = path.join(tmpDir, 'new-session.jsonl');
    writeAssistantMessage(newFile, 'Fixed the dashboard layout issue successfully');

    const sessions = [
      makeDiscovered({sessionId: 'old-session', jsonlFile: oldFile}),
      makeDiscovered({sessionId: 'new-session', jsonlFile: newFile}),
    ];

    const result = matchSessionBySnippets(['Fixed the dashboard layout iss'], sessions);
    expect(result).toBe('new-session');
  });

  test('handles empty inputs', () => {
    expect(matchSessionBySnippets([], [])).toBeNull();
    expect(matchSessionBySnippets(['hello'], [])).toBeNull();

    const file = path.join(tmpDir, 'session-a.jsonl');
    writeAssistantMessage(file, 'hello');
    const sessions = [makeDiscovered({sessionId: 'session-a', jsonlFile: file})];
    expect(matchSessionBySnippets([], sessions)).toBeNull();
  });

  test('exits early on first full match', () => {
    const fileA = path.join(tmpDir, 'session-a.jsonl');
    writeAssistantMessage(fileA, 'All tests pass with zero failures in the suite');

    const fileB = path.join(tmpDir, 'session-b.jsonl');
    writeAssistantMessage(fileB, 'All tests pass with zero failures in the suite');

    const sessions = [
      makeDiscovered({sessionId: 'session-a', jsonlFile: fileA}),
      makeDiscovered({sessionId: 'session-b', jsonlFile: fileB}),
    ];

    const result = matchSessionBySnippets(['All tests pass with zero fail'], sessions);
    expect(result).toBe('session-a');
  });

  test('returns null on partial tie', () => {
    const fileA = path.join(tmpDir, 'session-a.jsonl');
    writeAssistantMessage(fileA, 'Fixed the parser validation logic');

    const fileB = path.join(tmpDir, 'session-b.jsonl');
    writeAssistantMessage(fileB, 'Updated the database migration scripts');

    const sessions = [
      makeDiscovered({sessionId: 'session-a', jsonlFile: fileA}),
      makeDiscovered({sessionId: 'session-b', jsonlFile: fileB}),
    ];

    // Each session matches 1 of 2 snippets — a true tie
    const result = matchSessionBySnippets(
      ['Fixed the parser validation', 'Updated the database migration'],
      sessions,
    );
    expect(result).toBeNull();
  });

  test('returns match when only one session matches', () => {
    const fileA = path.join(tmpDir, 'session-a.jsonl');
    writeAssistantMessage(fileA, 'Refactored the authentication middleware to use async/await');

    const fileB = path.join(tmpDir, 'session-b.jsonl');
    writeAssistantMessage(fileB, 'Updated the database migration scripts for PostgreSQL');

    const sessions = [
      makeDiscovered({sessionId: 'session-a', jsonlFile: fileA}),
      makeDiscovered({sessionId: 'session-b', jsonlFile: fileB}),
    ];

    const result = matchSessionBySnippets(
      ['Refactored the authentication'],
      sessions,
    );
    expect(result).toBe('session-a');
  });
});
