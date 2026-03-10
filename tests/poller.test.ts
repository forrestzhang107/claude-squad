import {describe, test, expect} from 'vitest';
import {extractProjectName, parseTerminalState} from '../src/poller.js';

describe('extractProjectName', () => {
  test('returns basename of absolute path', () => {
    expect(extractProjectName('/Users/forrest/Repos/telvana/telvana-api')).toBe('telvana-api');
  });

  test('returns basename of simple path', () => {
    expect(extractProjectName('/tmp/my-project')).toBe('my-project');
  });

  test('handles trailing slash', () => {
    expect(extractProjectName('/Users/forrest/Repos/project/')).toBe('project');
  });

  test('handles root', () => {
    expect(extractProjectName('/')).toBe('/');
  });
});

describe('parseTerminalState', () => {
  // --- Permission detection (highest priority) ---

  test('detects permission prompt for Bash', () => {
    const content = lines(
      '⏺ I need to run the tests.',
      '',
      '  Allow Bash(npm test)?',
      '  Yes  No  Always allow',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('permission');
    expect(state.statusText).toBe('Needs permission');
  });

  test('detects permission prompt for MCP tool', () => {
    const content = 'Allow mcp__server__tool(args)?\nYes No';
    const state = parseTerminalState(content);
    expect(state.activity).toBe('permission');
  });

  test('detects permission prompt for Read', () => {
    const content = lines(
      '⏺ Let me check that file.',
      '',
      '  Allow Read(/Users/forrest/project/src/index.ts)?',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('permission');
  });

  // --- Waiting detection ---

  test('detects waiting state from Claude input prompt', () => {
    const content = lines(
      '⏺ Done! The fix has been applied.',
      '',
      '> ',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
    expect(state.statusText).toBe('Waiting for input');
  });

  test('detects waiting with empty prompt line', () => {
    const content = lines('⏺ All done.', '', '>');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  // --- Thinking detection ---

  test('detects thinking from Thinking line', () => {
    const content = lines('⏺ Thinking...');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('thinking');
    expect(state.statusText).toBe('Thinking...');
  });

  test('detects thinking from spinner-like output', () => {
    const content = lines(
      '⏺ Read(src/index.ts)',
      '  ⎿  [file contents]',
      '⏺ Thinking…',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('thinking');
  });

  // --- Tool active detection ---

  test('detects Read tool', () => {
    const content = lines('⏺ Read(src/parser.ts)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('reading');
    expect(state.statusText).toBe('Reading src/parser.ts');
  });

  test('detects Edit tool', () => {
    const content = lines('⏺ Edit(src/types.ts)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('editing');
    expect(state.statusText).toBe('Editing src/types.ts');
  });

  test('detects Write tool', () => {
    const content = lines('⏺ Write(src/new-file.ts)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('editing');
    expect(state.statusText).toBe('Writing src/new-file.ts');
  });

  test('detects Bash tool', () => {
    const content = lines('⏺ Bash(npm test)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('running');
    expect(state.statusText).toBe('$ npm test');
  });

  test('detects Bash tool with long command truncation', () => {
    const content = lines('⏺ Bash(npm run build && npm run test -- --coverage --reporter=verbose)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('running');
    expect(state.statusText.length).toBeLessThanOrEqual(45);
  });

  test('detects Glob tool', () => {
    const content = lines('⏺ Glob(src/**/*.ts)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('searching');
  });

  test('detects Grep tool', () => {
    const content = lines('⏺ Grep(pattern)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('searching');
  });

  test('detects Agent tool', () => {
    const content = lines('⏺ Agent(Explore the codebase)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('running');
    expect(state.statusText).toBe('Running subtask');
  });

  test('detects Task tool', () => {
    const content = lines('⏺ Task(run tests)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('running');
    expect(state.statusText).toBe('Running subtask');
  });

  test('detects WebSearch tool', () => {
    const content = lines('⏺ WebSearch(query)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('searching');
  });

  test('detects WebFetch tool', () => {
    const content = lines('⏺ WebFetch(url)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('searching');
  });

  test('detects MCP tool', () => {
    const content = lines('⏺ mcp__plugin__tool(args)');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Using mcp__plugin__tool');
  });

  // --- Responding detection ---

  test('detects text response', () => {
    const content = lines(
      '⏺ I found the issue in parser.ts. The problem is that',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Responding...');
  });

  // --- Edge cases ---

  test('empty content returns waiting', () => {
    const state = parseTerminalState('');
    expect(state.activity).toBe('waiting');
  });

  test('permission takes priority over tool active', () => {
    const content = lines(
      '⏺ Bash(npm test)',
      '',
      '  Allow Bash(npm test)?',
      '  Yes  No',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('permission');
  });

  test('uses last ⏺ line for state, not earlier ones', () => {
    const content = lines(
      '⏺ Read(old-file.ts)',
      '  ⎿  [file contents]',
      '⏺ Edit(new-file.ts)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('editing');
    expect(state.statusText).toBe('Editing new-file.ts');
  });

  test('ignores "Allow" in normal text', () => {
    const content = lines('⏺ We should allow users to configure this.');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Responding...');
  });
});

/** Helper to join lines for test readability. */
function lines(...args: string[]): string {
  return args.join('\n');
}
