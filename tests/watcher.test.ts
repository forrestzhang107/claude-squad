import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {describe, it, expect} from 'vitest';
import {
  createSession,
  applyInactiveTransition,
  readFullFile,
} from '../src/watcher.js';
import {makeSession, makeDiscovered} from './helpers.js';
import {systemTurnDuration, assistantText} from './helpers.js';

// ── applyInactiveTransition ──

describe('applyInactiveTransition', () => {
  it('transitions to inactive after 60 minutes', () => {
    const session = makeSession({activity: 'active'});
    const changed = applyInactiveTransition(session, 61 * 60 * 1000);
    expect(changed).toBe(true);
    expect(session.activity).toBe('inactive');
    expect(session.statusText).toBe('Inactive');
  });

  it('does not double-transition to inactive', () => {
    const session = makeSession({activity: 'inactive'});
    const changed = applyInactiveTransition(session, 120 * 60 * 1000);
    expect(changed).toBe(false);
  });

  it('does not transition when age is below threshold', () => {
    const session = makeSession({activity: 'active'});
    const changed = applyInactiveTransition(session, 30 * 60 * 1000);
    expect(changed).toBe(false);
    expect(session.activity).toBe('active');
  });

  it('transitions at exactly 60 minutes + 1ms', () => {
    const session = makeSession({activity: 'waiting'});
    const changed = applyInactiveTransition(session, 60 * 60 * 1000 + 1);
    expect(changed).toBe(true);
    expect(session.activity).toBe('inactive');
  });

  it('does not transition at exactly 60 minutes', () => {
    const session = makeSession({activity: 'active'});
    const changed = applyInactiveTransition(session, 60 * 60 * 1000);
    expect(changed).toBe(false);
  });

  it('transitions from any non-inactive state', () => {
    for (const activity of ['waiting', 'active', 'reading', 'editing', 'running', 'searching', 'permission', 'thinking'] as const) {
      const session = makeSession({activity});
      const changed = applyInactiveTransition(session, 61 * 60 * 1000);
      expect(changed).toBe(true);
      expect(session.activity).toBe('inactive');
    }
  });
});

// ── createSession ──

describe('createSession', () => {
  it('initializes with waiting state', () => {
    const session = createSession(makeDiscovered());
    expect(session.activity).toBe('waiting');
    expect(session.statusText).toBe('Waiting for input');
  });

  it('copies fields from discovered session', () => {
    const discovered = makeDiscovered({
      sessionId: 'abc',
      projectName: 'my-project',
      pid: 1234,
      processStartedAt: 9999,
    });
    const session = createSession(discovered);
    expect(session.sessionId).toBe('abc');
    expect(session.projectName).toBe('my-project');
    expect(session.pid).toBe(1234);
    expect(session.processStartedAt).toBe(9999);
  });

  it('initializes empty collections', () => {
    const session = createSession(makeDiscovered());
    expect(session.activeToolIds.size).toBe(0);
    expect(session.activeToolNames.size).toBe(0);
    expect(session.toolUseTimestamps.size).toBe(0);
    expect(session.pendingSubagentToolIds.size).toBe(0);
    expect(session.subagentToolTimestamps.size).toBe(0);
    expect(session.toolHistory).toEqual([]);
    expect(session.recentPaths).toEqual([]);
  });

  it('initializes numeric fields to zero', () => {
    const session = createSession(makeDiscovered());
    expect(session.sessionStartedAt).toBe(0);
    expect(session.contextTokens).toBe(0);
    expect(session.fileOffset).toBe(0);
    expect(session.respondedAt).toBe(0);
    expect(session.activeSubagents).toBe(0);
  });

  it('sets lastActivityAt from modifiedAt', () => {
    const ts = 1700000000000;
    const session = createSession(makeDiscovered({modifiedAt: ts}));
    expect(session.lastActivityAt).toBe(ts);
  });
});

// ── readFullFile ──

describe('readFullFile', () => {
  it('sets lastActivityAt to file mtime, not Date.now()', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
    const jsonlFile = path.join(tmpDir, 'test.jsonl');

    // Write a JSONL file with a turn_duration record (triggers resetToolState)
    fs.writeFileSync(jsonlFile, [
      assistantText('hello'),
      systemTurnDuration(),
    ].join('\n') + '\n');

    // Backdate the file by 15 minutes
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    fs.utimesSync(jsonlFile, fifteenMinAgo, fifteenMinAgo);

    const session = createSession(makeDiscovered({jsonlFile}));
    readFullFile(session);

    // lastActivityAt should reflect file mtime (~15 min ago), not Date.now()
    const age = Date.now() - session.lastActivityAt;
    expect(age).toBeGreaterThan(14 * 60 * 1000);
    expect(session.activity).toBe('waiting');

    fs.rmSync(tmpDir, {recursive: true});
  });
});
