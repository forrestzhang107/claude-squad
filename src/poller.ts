import {execSync} from 'node:child_process';
import * as path from 'node:path';
import type {AgentActivity, AgentSession} from './types.js';

export interface ClaudeProcess {
  pid: number;
  startTime: number;
  tty: string;
  cwd: string;
}

export function extractProjectName(cwd: string): string {
  const cleaned = cwd.endsWith('/') && cwd.length > 1 ? cwd.slice(0, -1) : cwd;
  return path.basename(cleaned) || cwd;
}

/** Find all running claude processes with their start times, TTYs, and CWDs. */
export function discoverProcesses(): ClaudeProcess[] {
  const processes: ClaudeProcess[] = [];
  try {
    const lines = execSync("ps -eo pid,lstart,tty,comm | grep -w 'claude$'", {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);

    const pidToProc = new Map<number, Partial<ClaudeProcess>>();
    const pids: number[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const lstartStr = parts.slice(1, 6).join(' ');
      const ttyPart = parts[6];
      const startTime = new Date(lstartStr).getTime();
      const tty = ttyPart && ttyPart !== '??' && /^ttys\d+$/.test(ttyPart)
        ? `/dev/${ttyPart}`
        : undefined;

      if (startTime && tty) {
        pidToProc.set(pid, {pid, startTime, tty});
        pids.push(pid);
      }
    }

    if (pids.length > 0) {
      try {
        const lsofOutput = execSync(`lsof -a -d cwd -Fn -p ${pids.join(',')}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let currentPid = 0;
        for (const lsofLine of lsofOutput.split('\n')) {
          if (lsofLine.startsWith('p')) {
            currentPid = parseInt(lsofLine.slice(1), 10);
          } else if (lsofLine.startsWith('n') && currentPid) {
            const proc = pidToProc.get(currentPid);
            if (proc) proc.cwd = lsofLine.slice(1);
          }
        }
      } catch {
        // lsof failed
      }
    }

    for (const proc of pidToProc.values()) {
      if (proc.pid && proc.startTime && proc.tty && proc.cwd) {
        processes.push(proc as ClaudeProcess);
      }
    }
  } catch {
    // No claude processes
  }
  return processes;
}

/** Get git branch for a directory. Returns empty string on failure. */
export function getGitBranch(cwd: string): string {
  try {
    return execSync('git branch --show-current', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * How many characters from the end of terminal history to read.
 * Needs to be large enough to capture the last ⏺ tool call even after
 * verbose output (commit diffs, test results, long separator lines).
 */
const HISTORY_TAIL_CHARS = 10000;

/**
 * Batch-read recent terminal output for given TTYs from Terminal.app.
 * Uses `history of tab` and takes only the last HISTORY_TAIL_CHARS characters
 * to keep data transfer small and focus on current state.
 */
export function readTerminalContents(ttys: string[]): Map<string, string> {
  const contents = new Map<string, string>();
  if (ttys.length === 0) return contents;

  try {
    const SEPARATOR = '___TTY_SEP___';
    const ttySet = ttys.map((t) => `"${t}"`).join(', ');
    const script = `
      tell application "Terminal"
        set ttyList to {${ttySet}}
        set output to ""
        repeat with w in windows
          repeat with t in tabs of w
            set ttyName to tty of t
            if ttyList contains ttyName then
              set h to history of t
              set hLen to length of h
              if hLen > ${HISTORY_TAIL_CHARS} then
                set h to text (hLen - ${HISTORY_TAIL_CHARS - 1}) thru hLen of h
              end if
              set output to output & ttyName & "${SEPARATOR}" & h & "${SEPARATOR}${SEPARATOR}"
            end if
          end repeat
        end repeat
        return output
      end tell
    `;
    const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024, // 10MB — history can be large even when trimmed
    });

    for (const chunk of raw.split(`${SEPARATOR}${SEPARATOR}`)) {
      const sepIdx = chunk.indexOf(SEPARATOR);
      if (sepIdx === -1) continue;
      const tty = chunk.slice(0, sepIdx).trim();
      const content = chunk.slice(sepIdx + SEPARATOR.length);
      if (tty) contents.set(tty, content);
    }
  } catch {
    // Terminal.app not running or AppleScript failed
  }

  return contents;
}

const PERMISSION_RE = /Allow \w[\w:.-]*\(.*?\)\?/;
// Newer Claude Code permission format: "Do you want to proceed?" followed by
// "❯ 1. Yes" selector within a few lines (not inside quoted strings/diffs)
const PERMISSION_PROCEED_RE = /Do you want to proceed\?\s*\n\s*❯ 1\. Yes/;
const TOOL_LINE_RE = /^⏺ (\w[\w:.-]*)\((.*)?\)\s*$/;
const THINKING_RE = /^⏺ Thinking[.…]/;
const COLLAPSED_SEARCH_RE = /^⏺ Searched for \d+ pattern/;
const COLLAPSED_READ_RE = /^⏺ Read \d+ files?\b/;
// Active spinner: non-ASCII char followed by a verb ending in … (unicode ellipsis).
// e.g. "✳ Wandering… (1m 14s · ↓ 896 tokens)", "✢ Tomfoolering… (54s)"
// Claude Code animates through many spinner characters — match the pattern, not the char.
const ACTIVE_SPINNER_RE = /^[^\x00-\x7F] \w+\u2026/;
// ✻ completion summary: "✻ Brewed for 2m 1s", "✻ Sautéed for 52s", "✻ Worked for 44s"
const COMPLETION_RE = /^✻ .+ for \d/;
const BASH_CMD_MAX = 40;

interface TerminalState {
  activity: AgentActivity;
  statusText: string;
}

/**
 * Parse visible terminal content into an activity state.
 *
 * Key insight: Claude Code's ❯ prompt is ALWAYS visible at the bottom of the
 * terminal, even while actively working. We cannot use ❯ position to detect
 * waiting state. Instead, we use ✻ (completion summary like "✻ Brewed for 2m")
 * as the reliable "done" marker — it appears after every response cycle.
 */
export function parseTerminalState(content: string): TerminalState {
  if (!content || !content.trim()) {
    return {activity: 'waiting', statusText: 'Waiting for input'};
  }

  // 1. Permission — highest priority (check last 2000 chars)
  const tail = content.slice(-2000);
  if (PERMISSION_RE.test(tail) || PERMISSION_PROCEED_RE.test(tail)) {
    return {activity: 'permission', statusText: 'Needs permission'};
  }

  // 2. Scan backwards for key markers.
  //    ⏺ = tool call or response line
  //    ✻ = completion summary (Claude finished a response cycle)
  //    ✢ = active spinner (Claude is thinking/working)
  const allLines = content.split('\n');
  let lastBulletIdx = -1;
  let lastCompletionIdx = -1;
  let lastToolLine: RegExpMatchArray | null = null;
  let lastBulletIsText = false;
  let lastBulletIsThinking = false;
  let lastBulletIsSearch = false;
  let lastBulletIsRead = false;
  let activeSpinnerIdx = -1;

  for (let i = allLines.length - 1; i >= 0; i--) {
    const line = allLines[i].trim();

    // Track ✻ completion summary (e.g. "✻ Churned for 1m 29s")
    if (lastCompletionIdx === -1 && COMPLETION_RE.test(line)) {
      lastCompletionIdx = i;
    }

    // Track ✢ active spinner (e.g. "✢ Tomfoolering… (54s · ↓ 185 tokens)")
    if (activeSpinnerIdx === -1 && ACTIVE_SPINNER_RE.test(line)) {
      activeSpinnerIdx = i;
    }

    if (line.startsWith('⏺') && lastBulletIdx === -1) {
      lastBulletIdx = i;

      if (THINKING_RE.test(line)) {
        lastBulletIsThinking = true;
      } else if (COLLAPSED_SEARCH_RE.test(line)) {
        lastBulletIsSearch = true;
      } else if (COLLAPSED_READ_RE.test(line)) {
        lastBulletIsRead = true;
      } else {
        const toolMatch = line.match(TOOL_LINE_RE);
        if (toolMatch) {
          lastToolLine = toolMatch;
        } else if (line.length > 2) {
          lastBulletIsText = true;
        }
      }
    }

    // Stop once we've found all three markers
    if (lastBulletIdx !== -1 && lastCompletionIdx !== -1 && activeSpinnerIdx !== -1) break;
  }

  // 3. ✢ active spinner is the most recent marker → Claude is thinking
  if (activeSpinnerIdx !== -1 && activeSpinnerIdx > lastBulletIdx && activeSpinnerIdx > lastCompletionIdx) {
    return {activity: 'thinking', statusText: 'Thinking...'};
  }

  // 4. ✻ completion summary after last ⏺ → Claude finished, waiting for input
  if (lastCompletionIdx !== -1 && lastCompletionIdx > lastBulletIdx) {
    return {activity: 'waiting', statusText: 'Waiting for input'};
  }

  // 5. Thinking — model is reasoning (⏺ Thinking...)
  if (lastBulletIsThinking) {
    return {activity: 'thinking', statusText: 'Thinking...'};
  }

  // 6. Tool active — determine specific activity from tool name
  if (lastToolLine) {
    const toolName = lastToolLine[1];
    const args = lastToolLine[2] || '';
    return mapToolToState(toolName, args);
  }

  // 7. Collapsed tool summaries (e.g. "⏺ Searched for 3 patterns")
  if (lastBulletIsSearch) {
    return {activity: 'searching', statusText: 'Searching'};
  }
  if (lastBulletIsRead) {
    return {activity: 'reading', statusText: 'Reading files'};
  }

  // 8. Responding — last ⏺ line is text
  if (lastBulletIsText) {
    return {activity: 'active', statusText: 'Responding...'};
  }

  // 9. No ⏺ content found — fresh session or just a prompt
  return {activity: 'waiting', statusText: 'Waiting for input'};
}

function mapToolToState(toolName: string, args: string): TerminalState {
  switch (toolName) {
    case 'Read':
      return {activity: 'reading', statusText: `Reading ${args}`};
    case 'Edit':
    case 'Update':
      return {activity: 'editing', statusText: `Editing ${args}`};
    case 'Write':
      return {activity: 'editing', statusText: `Writing ${args}`};
    case 'Bash': {
      const cmd = args.length > BASH_CMD_MAX
        ? args.slice(0, BASH_CMD_MAX) + '...'
        : args;
      return {activity: 'running', statusText: `$ ${cmd}`};
    }
    case 'Glob':
    case 'Grep':
    case 'WebFetch':
    case 'WebSearch':
      return {activity: 'searching', statusText: 'Searching'};
    case 'Explore':
      return {activity: 'searching', statusText: 'Exploring codebase'};
    case 'Agent':
    case 'Task':
      return {activity: 'running', statusText: 'Running subtask'};
    default:
      return {activity: 'active', statusText: `Using ${toolName}`};
  }
}

export const INACTIVE_TIMEOUT_MS = 60 * 60 * 1000; // 60m waiting → inactive
const GIT_REFRESH_INTERVAL = 30; // refresh git branch every N polls (~60s at 2s poll)
/** Polls with unchanged content before "active" (responding) → "waiting". */
export const STABLE_CONTENT_THRESHOLD = 2;

/** Mutable poller state. Exported for testing via resetPollerState(). */
export interface PollerState {
  gitRefreshCounter: number;
  contentFingerprints: Map<number, { tail: string; stableCount: number }>;
}

const pollerState: PollerState = {
  gitRefreshCounter: 0,
  contentFingerprints: new Map(),
};

/** Reset mutable poller state. For testing only. */
export function resetPollerState(): void {
  pollerState.gitRefreshCounter = 0;
  pollerState.contentFingerprints.clear();
}

/** Dependency injection for pollSessions, enabling unit tests. */
export interface PollDeps {
  discoverProcesses: () => ClaudeProcess[];
  readTerminalContents: (ttys: string[]) => Map<string, string>;
  getGitBranch: (cwd: string) => string;
  now: () => number;
}

const defaultDeps: PollDeps = {
  discoverProcesses,
  readTerminalContents,
  getGitBranch,
  now: Date.now,
};

/**
 * Main poll function. Discovers running Claude processes, reads their
 * terminal content, and returns current session states.
 */
export function pollSessions(
  previous: Map<number, AgentSession>,
  deps: PollDeps = defaultDeps,
): AgentSession[] {
  const processes = deps.discoverProcesses();
  if (processes.length === 0) return [];

  const ttys = processes.map((p) => p.tty);
  const contents = deps.readTerminalContents(ttys);
  const refreshGit = ++pollerState.gitRefreshCounter >= GIT_REFRESH_INTERVAL;
  if (refreshGit) pollerState.gitRefreshCounter = 0;

  const activePids = new Set<number>();
  const sessions: AgentSession[] = [];

  for (const proc of processes) {
    activePids.add(proc.pid);
    const content = contents.get(proc.tty) || '';
    let {activity, statusText} = parseTerminalState(content);

    const prev = previous.get(proc.pid);

    // Content change detection: if "active" (responding) but content hasn't
    // changed for STABLE_CONTENT_THRESHOLD polls, Claude likely finished and
    // the ✻ completion marker was either absent or not captured.
    const tail = content.slice(-500);
    const fp = pollerState.contentFingerprints.get(proc.pid);
    if (fp && fp.tail === tail) {
      fp.stableCount++;
    } else {
      pollerState.contentFingerprints.set(proc.pid, { tail, stableCount: 0 });
    }

    if (activity === 'active' && (fp?.stableCount ?? 0) >= STABLE_CONTENT_THRESHOLD) {
      activity = 'waiting';
      statusText = 'Waiting for input';
    }

    // Preserve lastActivityAt if state hasn't meaningfully changed
    const now = deps.now();
    const stateChanged = !prev || prev.activity !== activity || prev.statusText !== statusText;
    const lastActivityAt = stateChanged ? now : prev.lastActivityAt;

    // Inactive transition: waiting for 60+ minutes → inactive
    if (activity === 'waiting' && now - lastActivityAt > INACTIVE_TIMEOUT_MS) {
      activity = 'inactive';
      statusText = 'Inactive';
    }

    // Git branch: cached, refreshed every ~60s
    const gitBranch = (refreshGit || !prev)
      ? deps.getGitBranch(proc.cwd)
      : prev.gitBranch;

    sessions.push({
      pid: proc.pid,
      tty: proc.tty,
      processStartedAt: proc.startTime,
      projectName: extractProjectName(proc.cwd),
      workingDirectory: proc.cwd,
      gitBranch,
      activity,
      statusText,
      lastActivityAt,
    });
  }

  // Clean up fingerprints for dead processes
  for (const pid of pollerState.contentFingerprints.keys()) {
    if (!activePids.has(pid)) pollerState.contentFingerprints.delete(pid);
  }

  // Sort by process start time (oldest first)
  sessions.sort((a, b) => a.processStartedAt - b.processStartedAt);
  return sessions;
}
