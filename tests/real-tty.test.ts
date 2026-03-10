/**
 * Tests using real Terminal.app history captured from a live Claude Code session.
 * Each snapshot is actual terminal output at a specific point in time,
 * verifying parseTerminalState produces correct states from real-world content.
 */
import {describe, test, expect} from 'vitest';
import {parseTerminalState} from '../src/poller.js';
import {lines} from './helpers.js';

/**
 * Real terminal snapshots from a Claude Code session working on telvana-api.
 * Each represents the last ~20 lines visible at a state transition point.
 */
describe('parseTerminalState with real TTY history', () => {
  test('waiting: ✻ completion summary after response', () => {
    // After Claude committed changes, ✻ summary marks completion
    const content = lines(
      '⏺ Committed. The 4 test-call related files remain uncommitted. Note the Prisma schema/migration rename was already committed earlier (commit 7ac6979).',
      '',
      '✻ Churned for 1m 29s',
      '',
      '❯ could you explain how the usage limits and email sending work now?',
      '                                                                     ',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  test('waiting: ✻ completion with background tasks and ❯ prompt', () => {
    // After thinking completes, ✻ summary appears, then ❯ prompt
    const content = lines(
      '⏺ Typecheck passes. Here\'s what changed:',
      '',
      '  - Added getCurrentBillingTotal to billing.service.ts',
      '  - usageLimit.service.ts now calls billingService.getCurrentBillingTotal()',
      '  - Removed the now-unused getCurrentMonthUsage function',
      '',
      '  The usage limit check and the invoice preview now use identical billing math.',
      '',
      '✻ Churned for 2m 30s · 1 background task still running (↓ to manage)',
      '',
      '❯ getcurrentbilling total vs previewlineitems?',
      '                                               ',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  test('running: Bash tool executing typecheck', () => {
    // Mid-execution: Bash tool is the last ⏺ line
    const content = lines(
      '⏺ Now regenerate Prisma client and typecheck.',
      '',
      '⏺ Bash(npm run prisma:generate 2>&1 | tail -5)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('running');
    expect(state.statusText).toBe('$ npm run prisma:generate 2>&1 | tail -5');
  });

  test('running: Bash with git operations', () => {
    const content = lines(
      '⏺ My changes are in: stripe.controller.ts, billing.routes.ts, billing.service.ts, usageLimit.service.ts.',
      '',
      '⏺ Bash(git add src/controllers/stripe.controller.ts src/routes/billing.routes.ts src/services/billing.service.ts src/services/usageLimit.service.ts && git commit -m "$…)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('running');
    expect(state.statusText).toMatch(/^\$ git add/);
  });

  test('editing: Update tool (real Claude Code uses Update, not Edit)', () => {
    // Real Claude Code shows "Update" not "Edit" for file edits
    const content = lines(
      '⏺ I see the replace_all only caught the data block references but missed the select/threshold logic. Let me fix the remaining 50 references.',
      '',
      '⏺ Update(src/services/usageLimit.service.ts)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('editing');
    expect(state.statusText).toBe('Editing src/services/usageLimit.service.ts');
  });

  test('editing: Update tool with schema file', () => {
    const content = lines(
      '⏺ Read 2 files (ctrl+o to expand)',
      '',
      '⏺ Update(prisma/schema.prisma)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('editing');
  });

  test('active: responding with text after tool output', () => {
    // Claude is explaining what it did — last ⏺ is text, not a tool
    const content = lines(
      '⏺ Bash(npm run typecheck 2>&1 | tail -5)',
      '  ⎿  > telvana-api@1.0.0 typecheck',
      '     > tsc --noEmit',
      '',
      '⏺ Typecheck passes. Changed thresholds from 50/90/100 to 75/90/100 across:',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Responding...');
  });

  test('active: responding with multi-line explanation', () => {
    const content = lines(
      '⏺ You\'re right — having two functions that compute the same thing is fragile. Let me refactor previewLineItems to use getCurrentBillingTotal... but it can\'t, because it needs the individual',
      '  line items for display.',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Responding...');
  });

  test('active: superpowers skill tool call', () => {
    // superpowers:code-reviewer is a tool with colons in the name
    const content = lines(
      '❯ run code reviewer',
      '',
      '⏺ superpowers:code-reviewer(Review billing refactor changes)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Using superpowers:code-reviewer');
  });

  test('active: Skill tool call', () => {
    const content = lines(
      '❯ run code simplifier',
      '                                                                                   ',
      '⏺ Skill(simplify)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Using Skill');
  });

  test('searching: collapsed search summary', () => {
    // Real Claude Code collapses multi-tool operations
    const content = lines(
      '⏺ Let me check what needs to change — the Prisma schema has usageLimitNotified50.',
      '',
      '⏺ Searched for 3 patterns (ctrl+o to expand)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('searching');
  });

  test('reading: collapsed read summary', () => {
    const content = lines(
      '⏺ Now update the remaining references.',
      '',
      '⏺ Read 1 file (ctrl+o to expand)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('reading');
  });

  test('reading: collapsed multi-file read', () => {
    const content = lines(
      '⏺ I need to check the references in the files I need to update.',
      '',
      '⏺ Read 2 files (ctrl+o to expand)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('reading');
  });

  test('searching: Explore tool', () => {
    const content = lines(
      '❯ check out telvana-pipecat: we have /inbound and /outbound routes.',
      '                                                                                                                 ',
      '⏺ Explore(Explore telvana-pipecat routes)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('searching');
    expect(state.statusText).toBe('Exploring codebase');
  });

  test('thinking: ✢ active spinner during agent work', () => {
    // The ✢ spinner appears when Claude is actively thinking/working
    const content = lines(
      '⏺ Explore(Explore telvana-pipecat routes)',
      '  ⎿  Bash(find /Users/forrest/repos -type d -name "telvana-pipecat" 2>/dev/null)',
      '     Running…',
      '     ctrl+b to run in background',
      '',
      '✢ Tomfoolering… (54s · ↓ 185 tokens)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('thinking');
  });

  test('thinking: ✳ spinner variant (initial thinking)', () => {
    // Claude Code uses various Dingbat characters for spinners: ✢ ✳ ✽ etc.
    const content = lines(
      '❯ run code reviewer',
      '',
      '✳ Hatching…',
      '',
      '──────────────────────────────────────────────────────────────',
      '❯',
      '──────────────────────────────────────────────────────────────',
      '  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('thinking');
  });

  test('thinking: ✽ spinner variant during subagent work', () => {
    // Claude Code also uses ✽ (U+273D) for the active spinner, not just ✢ (U+2722)
    const content = lines(
      '❯ run code reviewer on changes',
      '',
      '  superpowers:code-reviewer(Code review all changes)',
      '  ⎿  Read(src/components/Dashboard.tsx)',
      '     Bash(git diff -- docs/architecture.md docs/agent-states.md)',
      '     Running…',
      '     +16 more tool uses (ctrl+o to expand)',
      '     ctrl+b to run in background',
      '',
      '✽ Simmering… (58s · ↓ 919 tokens)',
      '',
      '──────────────────────────────────────────────────────────────',
      '❯',
      '──────────────────────────────────────────────────────────────',
      '  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('thinking');
  });

  test('active: agent completion notification', () => {
    // "Agent X completed" is a text line, not a tool call
    const content = lines(
      '⏺ Agent "Code quality review" completed',
      '',
      '⏺ Quality review is in. Waiting for the other two agents to finish before making changes.',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('active');
    expect(state.statusText).toBe('Responding...');
  });

  test('running: Bash with piped command and git push', () => {
    const content = lines(
      '⏺ Bash(npm run format 2>&1 | tail -3 && npm run lint 2>&1 | tail -3 && npm run typecheck 2>&1 | tail -3)',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('running');
    // Should be truncated
    expect(state.statusText.length).toBeLessThanOrEqual(45);
  });

  test('waiting: ✻ completion at end of full session with decorators', () => {
    // Real terminal ending: ✻ summary, then ❯ prompt with separator lines
    const content = lines(
      '⏺ Pushed. Working tree is now clean.',
      '',
      '✻ Worked for 34s',
      '',
      '──────────────────────────────────────────────────────────',
      '❯',
      '──────────────────────────────────────────────────────────',
      '  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt',
    );
    const state = parseTerminalState(content);
    expect(state.activity).toBe('waiting');
  });

  test('full session walkthrough: progressive slices detect correct states', () => {
    // Simulate walking through a real session by building up content
    // and checking state at each major transition

    // Phase 1: Claude responds with text
    let content = lines(
      '⏺ Whether 50% is too soon depends on your billing cycles and customer behavior.',
    );
    expect(parseTerminalState(content).activity).toBe('active');

    // Phase 2: ✻ completion summary → waiting
    content = lines(
      '⏺ Want me to change the thresholds from 50/90/100 to 75/90/100?',
      '',
      '✻ Brewed for 2m 1s',
    );
    expect(parseTerminalState(content).activity).toBe('waiting');

    // Phase 3: Claude starts searching (⏺ after ✻ = new response cycle)
    content = lines(
      '✻ Brewed for 2m 1s',
      '',
      '❯ yes',
      '',
      '⏺ Searched for 1 pattern, read 1 file (ctrl+o to expand)',
    );
    expect(parseTerminalState(content).activity).toBe('searching');

    // Phase 4: Claude explains what it found
    content = lines(
      '⏺ Searched for 1 pattern, read 1 file (ctrl+o to expand)',
      '',
      '⏺ Now I need to update the DB schema field name and the service.',
    );
    expect(parseTerminalState(content).activity).toBe('active');

    // Phase 5: Claude edits a file
    content = lines(
      '⏺ Now I need to update the DB schema field name and the service.',
      '',
      '⏺ Update(prisma/schema.prisma)',
    );
    expect(parseTerminalState(content).activity).toBe('editing');

    // Phase 6: Claude runs typecheck
    content = lines(
      '⏺ Update(src/services/billing.service.ts)',
      '  ⎿  Added 1 line, removed 1 line',
      '',
      '⏺ Bash(npm run typecheck 2>&1 | tail -5)',
    );
    expect(parseTerminalState(content).activity).toBe('running');

    // Phase 7: Claude summarizes
    content = lines(
      '⏺ Bash(npm run typecheck 2>&1 | tail -5)',
      '  ⎿  > telvana-api@1.0.0 typecheck',
      '     > tsc --noEmit',
      '',
      '⏺ Typecheck passes. Changed thresholds from 50/90/100 to 75/90/100.',
    );
    expect(parseTerminalState(content).activity).toBe('active');

    // Phase 8: Back to waiting (✻ completion after last ⏺)
    content = lines(
      '⏺ Typecheck passes. Changed thresholds from 50/90/100 to 75/90/100.',
      '',
      '✻ Churned for 1m 29s',
    );
    expect(parseTerminalState(content).activity).toBe('waiting');
  });

  test('permission: "Do you want to proceed?" format for compound Bash commands', () => {
    // Newer Claude Code permission format for dangerous commands
    const content = lines(
      '❯ telvana-ui: push changes to develop',
      '',
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
});

