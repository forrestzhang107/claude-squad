import {describe, test, expect} from 'vitest';
import {extractProjectName, parseTerminalState} from '../src/poller.js';
import {lines} from './helpers.js';

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

  test('detects "Do you want to proceed?" permission format', () => {
    const content = lines(
      '⏺ Bash(cd /Users/forrest/repos/telvana && git status -s)',
      '  ⎿  Running…',
      '',
      '──────────────────────────────────────',
      ' Bash command',
      '',
      '   cd /Users/forrest/repos/telvana && git status -s',
      '   Check UI repo status',
      '',
      ' Compound commands with cd and git require approval to prevent bare repository attacks',
      '',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      '',
      ' Esc to cancel · Tab to amend · ctrl+e to explain',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('permission');
    expect(state.statusText).toBe('Needs permission');
  });

  test('does NOT trigger permission for "Do you want to proceed?" in diff output', () => {
    // When Claude shows a diff containing test code with "Do you want to proceed?",
    // it should NOT be classified as a permission prompt
    const content = lines(
      '⏺ Update(tests/real-tty.test.ts)',
      '  ⎿  Added 27 lines',
      '      362 +      \' Do you want to proceed?\',',
      '      363 +      \' ❯ 1. Yes\',',
      '      364 +      \'   2. No\',',
      '',
      '⏺ All 74 tests pass.',
      '',
      '✻ Brewed for 51s',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  // --- Waiting detection ---
  // Note: Claude Code's ❯ prompt is always visible at the bottom of the terminal,
  // even while actively working. We use ✻ completion summaries (e.g. "✻ Brewed for 2m")
  // as the reliable "done" marker instead.

  test('detects waiting from ✻ completion summary after response', () => {
    const content = lines(
      '⏺ Done! The fix has been applied.',
      '',
      '✻ Worked for 30s',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
    expect(state.statusText).toBe('Waiting for input');
  });

  test('detects waiting from ✻ with duration variants', () => {
    const content = lines('⏺ All done.', '', '✻ Brewed for 2m 1s');
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  test('detects waiting from ✻ with background tasks', () => {
    const content = lines(
      '⏺ Changes pushed.',
      '',
      '✻ Churned for 1m 29s · 1 background task still running (↓ to manage)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  test('detects waiting with realistic terminal output (✻ + ❯ + decorators)', () => {
    // Real terminal: ⏺ response, ✻ summary, then ❯ prompt with separator lines
    const content = lines(
      '⏺ Pushed e2ed576 to develop.',
      '',
      '✻ Sautéed for 52s',
      '',
      '──────────────────────────────────────',
      '❯  ',
      '──────────────────────────────────────',
      '  ? for shortcuts',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  test('does NOT show waiting when ⏺ appears after ✻ (new response cycle)', () => {
    // User submitted, Claude started a new response — ⏺ lines come after ✻
    const content = lines(
      '✻ Worked for 30s',
      '',
      '❯ fix the bug',
      '⏺ I found the issue in parser.ts.',
      '⏺ Read(src/parser.ts)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('reading');
  });

  test('does NOT show waiting when Claude is thinking (⏺ after ✻)', () => {
    // ❯ prompt is always visible, but ⏺ content after ✻ means new response cycle
    const content = lines(
      '✻ Brewed for 1m',
      '',
      '──────────────────────────────────────',
      '❯ review the code',
      '──────────────────────────────────────',
      '',
      '⏺ Thinking...',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('thinking');
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

