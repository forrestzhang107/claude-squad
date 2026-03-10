import {describe, test, expect, beforeEach} from 'vitest';
import {
  pollSessions,
  resetPollerState,
  INACTIVE_TIMEOUT_MS,
  STABLE_CONTENT_THRESHOLD,
} from '../src/poller.js';
import type {ClaudeProcess, PollDeps} from '../src/poller.js';
import type {AgentSession} from '../src/types.js';
import {lines} from './helpers.js';

/** Create a fake ClaudeProcess. */
function makeProc(overrides: Partial<ClaudeProcess> = {}): ClaudeProcess {
  return {
    pid: 100,
    startTime: Date.now() - 60000,
    tty: '/dev/ttys001',
    cwd: '/tmp/my-project',
    ...overrides,
  };
}

/** Create mock PollDeps with sensible defaults. */
function makeDeps(overrides: Partial<PollDeps> & {
  processes?: ClaudeProcess[];
  contents?: Map<string, string>;
} = {}): PollDeps {
  const {processes = [], contents = new Map(), ...rest} = overrides;
  return {
    discoverProcesses: () => processes,
    readTerminalContents: () => contents,
    getGitBranch: () => 'main',
    now: () => Date.now(),
    ...rest,
  };
}

/** Build a previous-session map from an array of sessions. */
function prevMap(sessions: AgentSession[]): Map<number, AgentSession> {
  return new Map(sessions.map((s) => [s.pid, s]));
}

describe('pollSessions', () => {
  beforeEach(() => {
    resetPollerState();
  });

  test('returns empty array when no processes found', () => {
    const deps = makeDeps();
    const result = pollSessions(new Map(), deps);
    expect(result).toEqual([]);
  });

  test('returns session with correct fields from process', () => {
    const proc = makeProc({pid: 42, cwd: '/Users/me/my-app'});
    const contents = new Map([[proc.tty, lines('✻ Worked for 10s')]]);
    const deps = makeDeps({processes: [proc], contents, getGitBranch: () => 'feature-x'});

    const result = pollSessions(new Map(), deps);
    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(42);
    expect(result[0].tty).toBe(proc.tty);
    expect(result[0].projectName).toBe('my-app');
    expect(result[0].workingDirectory).toBe('/Users/me/my-app');
    expect(result[0].gitBranch).toBe('feature-x');
  });

  test('sorts sessions by process start time (oldest first)', () => {
    const now = Date.now();
    const proc1 = makeProc({pid: 1, startTime: now - 10000, tty: '/dev/ttys001'});
    const proc2 = makeProc({pid: 2, startTime: now - 50000, tty: '/dev/ttys002'});
    const deps = makeDeps({processes: [proc1, proc2]});

    const result = pollSessions(new Map(), deps);
    expect(result[0].pid).toBe(2); // older
    expect(result[1].pid).toBe(1); // newer
  });

  // --- Content-stale fallback ---

  test('content-stale: "active" transitions to "waiting" after stable content threshold', () => {
    const proc = makeProc();
    // Content that parses as "active" (responding text)
    const activeContent = lines('⏺ I found the issue in parser.ts.');
    const contents = new Map([[proc.tty, activeContent]]);
    const deps = makeDeps({processes: [proc], contents});

    // Poll 1: active, stableCount starts at 0
    let result = pollSessions(new Map(), deps);
    expect(result[0].activity).toBe('active');

    // Poll 2..N: same content, stableCount increments
    for (let i = 1; i < STABLE_CONTENT_THRESHOLD; i++) {
      result = pollSessions(prevMap(result), deps);
      expect(result[0].activity).toBe('active');
    }

    // Poll N+1: threshold reached, transitions to waiting
    result = pollSessions(prevMap(result), deps);
    expect(result[0].activity).toBe('waiting');
    expect(result[0].statusText).toBe('Waiting for input');
  });

  test('content-stale: resets when content changes', () => {
    const proc = makeProc();
    const content1 = lines('⏺ I found the issue.');
    const content2 = lines('⏺ I found the issue. Here is the fix.');
    let contents = new Map([[proc.tty, content1]]);
    const deps = makeDeps({
      processes: [proc],
      get contents() { return contents; },
      readTerminalContents: () => contents,
    });

    // Poll 1: active
    let result = pollSessions(new Map(), deps);
    expect(result[0].activity).toBe('active');

    // Poll 2: same content, still active
    result = pollSessions(prevMap(result), deps);
    expect(result[0].activity).toBe('active');

    // Content changes — counter resets
    contents = new Map([[proc.tty, content2]]);
    result = pollSessions(prevMap(result), deps);
    expect(result[0].activity).toBe('active');

    // Need STABLE_CONTENT_THRESHOLD more polls with same content to transition
    for (let i = 0; i < STABLE_CONTENT_THRESHOLD; i++) {
      result = pollSessions(prevMap(result), deps);
    }
    expect(result[0].activity).toBe('waiting');
  });

  test('content-stale: only affects "active" state, not other states', () => {
    const proc = makeProc();
    // Content that parses as "running" (Bash tool)
    const runningContent = lines('⏺ Bash(npm test)');
    const contents = new Map([[proc.tty, runningContent]]);
    const deps = makeDeps({processes: [proc], contents});

    // Poll many times with same content — should stay "running", never "waiting"
    let result = pollSessions(new Map(), deps);
    for (let i = 0; i < STABLE_CONTENT_THRESHOLD + 5; i++) {
      result = pollSessions(prevMap(result), deps);
    }
    expect(result[0].activity).toBe('running');
  });

  // --- Inactive timeout ---

  test('inactive: waiting session becomes inactive after timeout', () => {
    const proc = makeProc();
    const waitingContent = lines('⏺ Done.', '', '✻ Worked for 10s');
    const contents = new Map([[proc.tty, waitingContent]]);

    let currentTime = Date.now();
    const deps = makeDeps({
      processes: [proc],
      contents,
      now: () => currentTime,
    });

    // Poll 1: waiting
    let result = pollSessions(new Map(), deps);
    expect(result[0].activity).toBe('waiting');

    // Advance time past the timeout
    currentTime += INACTIVE_TIMEOUT_MS + 1;

    // Poll 2: should transition to inactive
    result = pollSessions(prevMap(result), deps);
    expect(result[0].activity).toBe('inactive');
    expect(result[0].statusText).toBe('Inactive');
  });

  test('inactive: does NOT trigger if activity changes before timeout', () => {
    const proc = makeProc();
    const waitingContent = lines('⏺ Done.', '', '✻ Worked for 10s');
    const activeContent = lines('⏺ Starting new work now.');

    let currentTime = Date.now();
    let contents = new Map([[proc.tty, waitingContent]]);
    const deps = makeDeps({
      processes: [proc],
      readTerminalContents: () => contents,
      now: () => currentTime,
    });

    // Poll 1: waiting
    let result = pollSessions(new Map(), deps);
    expect(result[0].activity).toBe('waiting');

    // Advance partway, then change to active
    currentTime += INACTIVE_TIMEOUT_MS / 2;
    contents = new Map([[proc.tty, activeContent]]);
    result = pollSessions(prevMap(result), deps);
    expect(result[0].activity).toBe('active');

    // Advance past original timeout — should NOT be inactive (timer reset)
    currentTime += INACTIVE_TIMEOUT_MS / 2 + 1;
    result = pollSessions(prevMap(result), deps);
    expect(result[0].activity).not.toBe('inactive');
  });

  // --- Git branch caching ---

  test('git branch: fetched on first poll, cached on subsequent', () => {
    const proc = makeProc();
    const contents = new Map([[proc.tty, '']]);
    let gitCalls = 0;
    const deps = makeDeps({
      processes: [proc],
      contents,
      getGitBranch: () => { gitCalls++; return 'develop'; },
    });

    // Poll 1: fetches git branch
    const result = pollSessions(new Map(), deps);
    expect(result[0].gitBranch).toBe('develop');
    expect(gitCalls).toBe(1);

    // Poll 2: uses cached value
    pollSessions(prevMap(result), deps);
    expect(gitCalls).toBe(1); // not called again
  });

  // --- Fingerprint cleanup ---

  test('cleans up fingerprints for dead processes', () => {
    const proc1 = makeProc({pid: 1, tty: '/dev/ttys001'});
    const proc2 = makeProc({pid: 2, tty: '/dev/ttys002'});
    const contents = new Map([
      [proc1.tty, lines('⏺ Working.')],
      [proc2.tty, lines('⏺ Also working.')],
    ]);

    // Poll with both processes
    const deps1 = makeDeps({processes: [proc1, proc2], contents});
    let result = pollSessions(new Map(), deps1);
    expect(result).toHaveLength(2);

    // Poll again with only proc1 (proc2 died)
    const deps2 = makeDeps({processes: [proc1], contents});
    result = pollSessions(prevMap(result), deps2);
    expect(result).toHaveLength(1);
    expect(result[0].pid).toBe(1);

    // Verify proc2 doesn't cause issues if it comes back with new PID
    const proc3 = makeProc({pid: 3, tty: '/dev/ttys002'});
    const deps3 = makeDeps({processes: [proc1, proc3], contents: new Map([
      [proc1.tty, lines('⏺ Working.')],
      [proc3.tty, lines('⏺ New process.')],
    ])});
    result = pollSessions(prevMap(result), deps3);
    expect(result).toHaveLength(2);
  });

  test('caches lastPrompt across polls when prompt leaves history window', () => {
    const proc = makeProc();
    // Poll 1: terminal has a visible prompt
    const contents1 = new Map([[proc.tty, lines(
      '❯ fix the bug',
      '⏺ Working on it.',
      '✻ Worked for 10s',
      '❯ ',
    )]]);
    const deps1 = makeDeps({processes: [proc], contents: contents1});
    let result = pollSessions(new Map(), deps1);
    expect(result[0].lastPrompt).toBe('fix the bug');

    // Poll 2: prompt scrolled out of history (no ❯ with text)
    const contents2 = new Map([[proc.tty, lines(
      '⏺ Done. The bug is fixed.',
      '✻ Worked for 30s',
      '❯ ',
    )]]);
    const deps2 = makeDeps({processes: [proc], contents: contents2});
    result = pollSessions(prevMap(result), deps2);
    expect(result[0].lastPrompt).toBe('fix the bug');
  });
});
