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

  // --- Question detection (AskUserQuestion) ---

  test('detects AskUserQuestion UI as question state', () => {
    const content = lines(
      '⏺ Bash(ls .worktrees/ 2>/dev/null; echo "---"; git worktree list)',
      '  ⎿  agent-navigation',
      '     robust-session-mapping',
      '     updown-nav',
      '',
      '──────────────────────────────────────',
      ' ☐ Branch name',
      '',
      ' What should the new branch be named?',
      '',
      ' ❯ 1. feature/...',
      '       I\'ll type a feature branch name',
      '   2. fix/...',
      '       I\'ll type a bugfix branch name',
      '   3. refactor/...',
      '       I\'ll type a refactor branch name',
      '   4. Type something.',
      '──────────────────────────────────────',
      '   5. Chat about this',
      'Enter to select · ↑/↓ to navigate · Esc to cancel',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('question');
    expect(state.statusText).toBe('Asking question');
  });

  test('question takes priority over tool active', () => {
    const content = lines(
      '⏺ Agent(Explore the codebase)',
      '  ⎿  Running…',
      '',
      ' ☐ Approach',
      ' Which approach should we use?',
      ' ❯ 1. Option A',
      '   2. Option B',
      'Enter to select · ↑/↓ to navigate · Esc to cancel',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('question');
  });

  test('does NOT trigger question for "Enter to select" in diff output', () => {
    const content = lines(
      '⏺ Update(tests/poller.test.ts)',
      '  ⎿  Added 10 lines',
      "      100 +      'Enter to select · ↑/↓ to navigate · Esc to cancel',",
      '',
      '⏺ All tests pass.',
      '',
      '✻ Brewed for 30s',
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

  // --- Conversation extraction (lastPrompt + lastResponse) ---

  test('extracts last user prompt', () => {
    const content = lines(
      '❯ fix the bug in auth.ts',
      '⏺ Read(src/auth.ts)',
    );
    const state = parseTerminalState(content);
    expect(state.lastPrompt).toBe('fix the bug in auth.ts');
  });

  test('extracts last prompt when multiple prompts exist', () => {
    const content = lines(
      '❯ first prompt',
      '⏺ Done.',
      '✻ Worked for 10s',
      '❯ second prompt',
      '⏺ Read(file.ts)',
    );
    const state = parseTerminalState(content);
    expect(state.lastPrompt).toBe('second prompt');
  });

  test('does not match ❯ numbered menu items as prompt', () => {
    const content = lines(
      '❯ real user prompt',
      '⏺ Bash(git status)',
      '  ⎿  Running…',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
    );
    const state = parseTerminalState(content);
    expect(state.lastPrompt).toBe('real user prompt');
  });

  test('returns empty prompt when none exists', () => {
    const content = lines('⏺ Read(file.ts)');
    const state = parseTerminalState(content);
    expect(state.lastPrompt).toBe('');
  });

  test('extracts response lines from text after tools', () => {
    const content = lines(
      '❯ explain this',
      '⏺ Read(src/index.ts)',
      '  ⎿  [file contents]',
      '⏺ The issue is in the parser.',
      '  It fails on edge cases.',
      '  We need to fix the regex.',
      '✻ Worked for 30s',
      '❯ ',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual([
      'The issue is in the parser.',
      'It fails on edge cases.',
      'We need to fix the regex.',
    ]);
  });

  test('limits response to 3 lines', () => {
    const content = lines(
      '⏺ Line one.',
      '  Line two.',
      '  Line three.',
      '  Line four.',
      '  Line five.',
      '✻ Worked for 10s',
      '❯ ',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual([
      'Line one.',
      'Line two.',
      'Line three.',
    ]);
  });

  test('returns empty response when only tool calls exist', () => {
    const content = lines(
      '❯ do something',
      '⏺ Read(file.ts)',
      '  ⎿  contents',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual([]);
  });

  test('skips terminal chrome in response collection', () => {
    const content = lines(
      '⏺ All done.',
      '✻ Worked for 5s',
      '──────────────────────────────────────',
      '❯ ',
      '──────────────────────────────────────',
      '⏵⏵ accept edits',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual(['All done.']);
  });

  test('empty content returns empty prompt and response', () => {
    const state = parseTerminalState('');
    expect(state.lastPrompt).toBe('');
    expect(state.lastResponse).toEqual([]);
  });

  // --- ❯ prompt after text → waiting detection ---

  test('detects waiting when ❯ prompt follows text response', () => {
    const content = lines(
      '⏺ Pushed to origin/main.',
      '──────────────────────────────────────',
      '❯ ',
      '──────────────────────────────────────',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  // --- Response survives through tool calls ---

  test('shows text response from before active tool calls', () => {
    const content = lines(
      '⏺ Good findings. Let me address the actionable ones.',
      '⏺ Update(src/poller.ts)',
      '  ⎿  Added 1 line, removed 1 line',
      '⏺ Bash(npm run build)',
      '  ⎿  running...',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual([
      'Good findings. Let me address the actionable ones.',
    ]);
  });

  // --- Agent notification filtering from lastResponse ---

  test('skips Agent notification and shows prior text response', () => {
    const content = lines(
      '⏺ Code reviewer confirmed everything is clean.',
      '⏺ Agent "Simplify changed code" completed',
      '✳ Thinking… (12s)',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual(['Code reviewer confirmed everything is clean.']);
  });

  test('skips Agent notification with single quotes', () => {
    const content = lines(
      '⏺ Here is the summary.',
      "⏺ Agent 'Review code' completed",
      '✻ Worked for 30s',
      '❯ ',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual(['Here is the summary.']);
  });

  test('skips collapsed write/edit summaries from response', () => {
    const content = lines(
      '⏺ Fixed the formatting issues.',
      '⏺ Edited 3 files',
      '✻ Worked for 15s',
      '❯ ',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual(['Fixed the formatting issues.']);
  });

  // --- Tool sub-output filtering from lastResponse ---

  test('omits tool sub-output between tool call and response', () => {
    const content = lines(
      '⏺ Bash(gh run list --limit 3)',
      '  ⎿  completed  success Release: staging',
      '     completed  success Release: prod',
      '⏺ Yes, deployed successfully.',
      '✻ Worked for 30s',
      '❯ ',
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).toEqual(['Yes, deployed successfully.']);
  });

  // --- Chrome hint filtering from lastResponse ---

  test.each([
    ['⏵⏵ hint with esc to interrupt', '  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt', 'esc to interrupt'],
    ['? for shortcuts', '  ? for shortcuts', '? for shortcuts'],
    ['standalone esc to interrupt', 'esc to interrupt', 'esc to interrupt'],
    ['Press up to edit queued messages', '  Press up to edit queued messages', 'Press up to edit queued messages'],
  ])('omits %s from lastResponse', (_label, chromeLine, excluded) => {
    const content = lines(
      '⏺ Here is my response.',
      '──────────────────────────────────────',
      '❯ ',
      '──────────────────────────────────────',
      chromeLine,
    );
    const state = parseTerminalState(content);
    expect(state.lastResponse).not.toContainEqual(
      expect.stringContaining(excluded),
    );
  });
});

