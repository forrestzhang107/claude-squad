import {exec, spawn, type ChildProcess} from 'node:child_process';
import {writeFileSync, symlinkSync, unlinkSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {promisify} from 'node:util';

import type {AgentActivity, AgentSession} from './types.js';

const execAsync = promisify(exec);

/**
 * How many characters from the end of terminal history to read.
 * Needs to be large enough to capture the last ⏺ tool call even after
 * verbose output (commit diffs, test results, long separator lines).
 */
const HISTORY_TAIL_CHARS = 10000;

/**
 * Persistent JXA (JavaScript for Automation) bridge process.
 * Spawned once to avoid flashing "osascript" in the Terminal.app tab name
 * on every poll cycle. Communicates via stdin/stdout JSON lines.
 */

const BRIDGE_SCRIPT = `
ObjC.import('Foundation');

var TAIL = ${HISTORY_TAIL_CHARS};
var stdin = $.NSFileHandle.fileHandleWithStandardInput;
var stdout = $.NSFileHandle.fileHandleWithStandardOutput;
var buf = $.NSMutableData.data;
var EOL = 0x0a;

function writeOut(str) {
  var d = $.NSString.alloc.initWithUTF8String(str + "\\n")
    .dataUsingEncoding($.NSUTF8StringEncoding);
  stdout.writeData(d);
}

while (true) {
  var chunk = stdin.availableData;
  if (chunk.length === 0) break;
  buf.appendData(chunk);

  while (true) {
    var len = buf.length;
    if (len === 0) break;
    var raw = buf.mutableBytes;
    if (!raw) break;
    var nlPos = -1;
    for (var i = 0; i < len; i++) { if (raw[i] === EOL) { nlPos = i; break; } }
    if (nlPos < 0) break;

    var lineData = buf.subdataWithRange($.NSMakeRange(0, nlPos));
    if (nlPos + 1 < len) {
      var rest = buf.subdataWithRange($.NSMakeRange(nlPos + 1, len - nlPos - 1));
      buf.setData(rest);
    } else {
      buf.setLength(0);
    }

    var line = $.NSString.alloc.initWithDataEncoding(lineData, $.NSUTF8StringEncoding).js;
    if (!line) continue;

    try {
      var ttyList = JSON.parse(line);
      var Terminal = Application('Terminal');
      var result = {};
      var windows = Terminal.windows();
      for (var wi = 0; wi < windows.length; wi++) {
        var tabs = windows[wi].tabs();
        for (var ti = 0; ti < tabs.length; ti++) {
          var tty = tabs[ti].tty();
          if (ttyList.indexOf(tty) >= 0) {
            var h = tabs[ti].history();
            if (h.length > TAIL) h = h.substring(h.length - TAIL);
            result[tty] = h;
          }
        }
      }
      writeOut(JSON.stringify(result));
    } catch(e) {
      writeOut(JSON.stringify({"__error": String(e)}));
    }
  }
}
`;

let bridgeScriptPath: string | null = null;
let osascriptSymlink: string | null = null;

function getBridgeScriptPath(): string {
  if (!bridgeScriptPath) {
    bridgeScriptPath = path.join(tmpdir(), `csq-bridge-${process.pid}.js`);
    writeFileSync(bridgeScriptPath, BRIDGE_SCRIPT);
  }
  return bridgeScriptPath;
}

/**
 * Get a symlink to osascript named "node" so Terminal.app shows "node"
 * (matching the parent process) instead of "osascript" in the tab title.
 */
function getOsascriptPath(): string {
  if (!osascriptSymlink) {
    const dir = path.join(tmpdir(), `csq-${process.pid}`);
    mkdirSync(dir, {recursive: true});
    const link = path.join(dir, 'node');
    try {
      try { unlinkSync(link); } catch {}
      symlinkSync('/usr/bin/osascript', link);
      osascriptSymlink = link;
    } catch {
      osascriptSymlink = 'osascript';
    }
  }
  return osascriptSymlink;
}

interface PendingRequest {
  resolve: (v: Record<string, string>) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JXABridge {
  proc: ChildProcess;
  buffer: string;
  pending: PendingRequest[];
}

let bridge: JXABridge | null = null;

function ensureBridge(): JXABridge {
  if (bridge && bridge.proc.exitCode === null && !bridge.proc.killed) {
    return bridge;
  }
  const scriptPath = getBridgeScriptPath();
  const proc = spawn(getOsascriptPath(), ['-l', 'JavaScript', scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const b: JXABridge = { proc, buffer: '', pending: [] };

  proc.stdout!.on('data', (d: Buffer) => {
    b.buffer += d.toString();
    let nlIdx: number;
    while ((nlIdx = b.buffer.indexOf('\n')) >= 0) {
      const line = b.buffer.slice(0, nlIdx);
      b.buffer = b.buffer.slice(nlIdx + 1);
      const req = b.pending.shift();
      if (req) {
        clearTimeout(req.timer);
        try {
          req.resolve(JSON.parse(line));
        } catch {
          req.resolve({});
        }
      }
    }
  });
  proc.on('exit', () => {
    for (const req of b.pending) {
      clearTimeout(req.timer);
      req.resolve({});
    }
    b.pending.length = 0;
    bridge = null;
  });
  proc.stderr!.resume(); // drain
  bridge = b;
  return b;
}

function queryBridge(ttys: string[]): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const b = ensureBridge();
    const timer = setTimeout(() => {
      const idx = b.pending.findIndex((p) => p.resolve === resolve);
      if (idx >= 0) b.pending.splice(idx, 1);
      resolve({});
    }, 10000);
    b.pending.push({resolve, timer});
    try {
      b.proc.stdin!.write(JSON.stringify(ttys) + '\n');
    } catch {
      // Bridge died between ensureBridge() and write (EPIPE)
      const idx = b.pending.findIndex((p) => p.resolve === resolve);
      if (idx >= 0) b.pending.splice(idx, 1);
      clearTimeout(timer);
      resolve({});
    }
  });
}

/** Kill the persistent JXA bridge and clean up temp files. */
process.on('exit', () => shutdownJXABridge());

export function shutdownJXABridge(): void {
  if (bridge) {
    bridge.proc.kill();
    bridge = null;
  }
  if (osascriptSymlink && osascriptSymlink !== 'osascript') {
    try {
      rmSync(path.dirname(osascriptSymlink), {recursive: true, force: true});
    } catch {}
    osascriptSymlink = null;
  }
  if (bridgeScriptPath) {
    try {
      unlinkSync(bridgeScriptPath);
    } catch {}
    bridgeScriptPath = null;
  }
}

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
export async function discoverProcesses(): Promise<ClaudeProcess[]> {
  const processes: ClaudeProcess[] = [];
  try {
    const {stdout} = await execAsync("ps -eo pid,lstart,tty,comm | grep -w 'claude$'");
    const lines = stdout.trim().split('\n').filter(Boolean);

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
        const {stdout: lsofOutput} = await execAsync(`lsof -a -d cwd -Fn -p ${pids.join(',')}`);
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
export async function getGitBranch(cwd: string): Promise<string> {
  try {
    const {stdout} = await execAsync('git branch --show-current', {cwd, timeout: 2000});
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Batch-read recent terminal output for given TTYs from Terminal.app.
 * Uses a persistent JXA bridge process to avoid flashing "osascript" in
 * the Terminal.app tab name on every poll.
 */
export async function readTerminalContents(ttys: string[]): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  if (ttys.length === 0) return contents;

  try {
    const result = await queryBridge(ttys);
    for (const [tty, content] of Object.entries(result)) {
      if (tty !== '__error' && content) {
        contents.set(tty, content);
      }
    }
  } catch {
    // Terminal.app not running or bridge failed
  }

  return contents;
}

const PERMISSION_RE = /Allow \w[\w:.-]*\(.*?\)\?/;
// Newer Claude Code permission format: "Do you want to proceed?" followed by
// "❯ 1. Yes" selector within a few lines (not inside quoted strings/diffs)
const PERMISSION_PROCEED_RE = /Do you want to proceed\?\s*\n\s*❯ 1\. Yes/;
// AskUserQuestion UI: shows numbered options with "Enter to select · ↑/↓ to navigate"
// Line-anchored (multiline) to avoid matching when this text appears inside diffs/quotes
const QUESTION_RE = /^\s*Enter to select · ↑\/↓ to navigate/m;
const TOOL_LINE_RE = /^⏺ (\w[\w:.-]*)\((.*)?\)\s*$/;
const THINKING_RE = /^⏺ Thinking[.…]/;
const COLLAPSED_SEARCH_RE = /^⏺ Searched for \d+ pattern/;
const COLLAPSED_READ_RE = /^⏺ Read \d+ files?\b/;
// Collapsed tool summaries that aren't plain-text response:
// ⏺ Wrote 3 files, ⏺ Edited 2 files, ⏺ Updated 5 files, ⏺ Agent "desc" completed
const COLLAPSED_TOOL_RE = /^⏺ (?:(?:Wrote|Edited|Updated) \d+ files?\b|Agent ["'])/;
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
  lastPrompt: string;
  lastResponse: string[];
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
    return {activity: 'waiting', statusText: 'Waiting for input', lastPrompt: '', lastResponse: []};
  }

  // 1. Permission — highest priority (check last 2000 chars)
  const tail = content.slice(-2000);

  // Parse conversation context (prompt + response) once for all return paths
  const allLines = content.split('\n');
  const conversation = parseConversation(allLines);

  if (PERMISSION_RE.test(tail) || PERMISSION_PROCEED_RE.test(tail)) {
    return {activity: 'permission', statusText: 'Needs permission', ...conversation};
  }

  // 1b. Question — AskUserQuestion UI visible (check tail)
  if (QUESTION_RE.test(tail)) {
    return {activity: 'question', statusText: 'Asking question', ...conversation};
  }

  // 2. Scan backwards for key markers.
  //    ⏺ = tool call or response line
  //    ✻ = completion summary (Claude finished a response cycle)
  //    ✢ = active spinner (Claude is thinking/working)
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
    return {activity: 'thinking', statusText: 'Thinking...', ...conversation};
  }

  // 4. ✻ completion summary after last ⏺ → Claude finished, waiting for input
  if (lastCompletionIdx !== -1 && lastCompletionIdx > lastBulletIdx) {
    return {activity: 'waiting', statusText: 'Waiting for input', ...conversation};
  }

  // 5. Thinking — model is reasoning (⏺ Thinking...)
  if (lastBulletIsThinking) {
    return {activity: 'thinking', statusText: 'Thinking...', ...conversation};
  }

  // 6. Tool active — determine specific activity from tool name
  if (lastToolLine) {
    const toolName = lastToolLine[1];
    const args = lastToolLine[2] || '';
    return {...mapToolToState(toolName, args), ...conversation};
  }

  // 7. Collapsed tool summaries (e.g. "⏺ Searched for 3 patterns")
  if (lastBulletIsSearch) {
    return {activity: 'searching', statusText: 'Searching', ...conversation};
  }
  if (lastBulletIsRead) {
    return {activity: 'reading', statusText: 'Reading files', ...conversation};
  }

  // 8. Responding — last ⏺ line is text
  //    But if there's a ❯ prompt after it (with only chrome in between),
  //    Claude has finished and the ✻ marker was missed or absent (e.g. interrupted).
  if (lastBulletIsText) {
    let hasPromptAfter = false;
    for (let i = lastBulletIdx + 1; i < allLines.length; i++) {
      const after = allLines[i].trim();
      if (!after || isChrome(after)) continue;
      hasPromptAfter = after.startsWith('❯');
      break;
    }
    if (hasPromptAfter) {
      return {activity: 'waiting', statusText: 'Waiting for input', ...conversation};
    }
    return {activity: 'active', statusText: 'Responding...', ...conversation};
  }

  // 9. No ⏺ content found — fresh session or just a prompt
  return {activity: 'waiting', statusText: 'Waiting for input', ...conversation};
}

const RESPONSE_LINES = 3;
const PROMPT_RE = /^❯\s+(.+)/;
const PROMPT_MENU_RE = /^❯\s+\d+\./;
const CHROME_RE = /^[─━\-=]{3,}/;

/** Lines that are terminal UI decoration, not content. */
function isChrome(trimmed: string): boolean {
  return CHROME_RE.test(trimmed) || trimmed.startsWith('⏵') ||
    trimmed === '? for shortcuts' || trimmed.includes('esc to interrupt') ||
    trimmed === 'Press up to edit queued messages';
}

/** Lines that mark the end of a response block (prompt, completion, spinner). */
function isResponseBoundary(trimmed: string): boolean {
  return trimmed.startsWith('❯') || COMPLETION_RE.test(trimmed) || ACTIVE_SPINNER_RE.test(trimmed);
}

/** Lines that are tool invocations or tool notifications (not plain-text response). */
function isToolBullet(trimmed: string): boolean {
  return TOOL_LINE_RE.test(trimmed) || THINKING_RE.test(trimmed) ||
    COLLAPSED_SEARCH_RE.test(trimmed) || COLLAPSED_READ_RE.test(trimmed) ||
    COLLAPSED_TOOL_RE.test(trimmed);
}

/** Extract the user's latest prompt and agent's latest text response from terminal content. */
function parseConversation(lines: string[]): { lastPrompt: string; lastResponse: string[] } {
  let lastPrompt = '';

  // Find the last ❯ prompt with text (skip numbered menu items like "❯ 1. Yes")
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (PROMPT_MENU_RE.test(trimmed)) continue;
    const m = trimmed.match(PROMPT_RE);
    if (m) {
      lastPrompt = m[1].trim();
      break;
    }
  }

  // Collect the last plain-text response lines from Claude.
  // First skip past trailing chrome (❯ prompt, ✻ completion, separators, spinners)
  // then collect response text until we hit a tool call or another prompt.
  let startIdx = lines.length - 1;
  for (; startIdx >= 0; startIdx--) {
    const trimmed = lines[startIdx].trim();
    if (!trimmed || isChrome(trimmed) || isResponseBoundary(trimmed)) continue;
    break;
  }

  // Pass 1: scan backwards to find the ⏺ text bullet that starts the response block
  let textBulletIdx = -1;
  for (let i = startIdx; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (isResponseBoundary(trimmed)) break;
    if (isChrome(trimmed)) continue;
    if (trimmed.startsWith('⏺')) {
      if (isToolBullet(trimmed)) continue;
      textBulletIdx = i;
      break;
    }
    if (trimmed.startsWith('⎿')) continue;
  }

  // Pass 2: collect the text bullet and its continuation lines (below it)
  const responseLines: string[] = [];
  if (textBulletIdx >= 0) {
    const bulletTrimmed = lines[textBulletIdx].trim();
    if (bulletTrimmed.length > 2) {
      responseLines.push(bulletTrimmed.slice(2).trim());
    }
    for (let i = textBulletIdx + 1; i < lines.length && responseLines.length < RESPONSE_LINES; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (isChrome(trimmed) || isResponseBoundary(trimmed)) break;
      if (trimmed.startsWith('⏺') || trimmed.startsWith('⎿')) break;
      responseLines.push(trimmed);
    }
  }
  return { lastPrompt, lastResponse: responseLines.slice(0, RESPONSE_LINES) };
}

function mapToolToState(toolName: string, args: string): { activity: AgentActivity; statusText: string } {
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

const GIT_REFRESH_INTERVAL = 30; // refresh git branch every N polls (~60s at 2s poll)
/** Polls with unchanged content before "active" (responding) → "waiting". */
export const STABLE_CONTENT_THRESHOLD = 2;

/** Mutable poller state. Exported for testing via resetPollerState(). */
export interface PollerState {
  gitRefreshCounter: number;
  contentFingerprints: Map<number, { tail: string; stableCount: number }>;
  lastKnownPrompts: Map<number, string>;
  lastKnownResponses: Map<number, string[]>;
}

const pollerState: PollerState = {
  gitRefreshCounter: 0,
  contentFingerprints: new Map(),
  lastKnownPrompts: new Map(),
  lastKnownResponses: new Map(),
};

/** Reset mutable poller state. For testing only. */
export function resetPollerState(): void {
  pollerState.gitRefreshCounter = 0;
  pollerState.contentFingerprints.clear();
  pollerState.lastKnownPrompts.clear();
  pollerState.lastKnownResponses.clear();
}

/** Dependency injection for pollSessions, enabling unit tests. */
export interface PollDeps {
  discoverProcesses: () => ClaudeProcess[] | Promise<ClaudeProcess[]>;
  readTerminalContents: (ttys: string[]) => Map<string, string> | Promise<Map<string, string>>;
  getGitBranch: (cwd: string) => string | Promise<string>;
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
export async function pollSessions(
  previous: Map<number, AgentSession>,
  deps: PollDeps = defaultDeps,
): Promise<AgentSession[]> {
  const processes = await deps.discoverProcesses();
  if (processes.length === 0) return [];

  const ttys = processes.map((p) => p.tty);
  const contents = await deps.readTerminalContents(ttys);
  const refreshGit = ++pollerState.gitRefreshCounter >= GIT_REFRESH_INTERVAL;
  if (refreshGit) pollerState.gitRefreshCounter = 0;

  // Git branch: fetch in parallel for processes that need a refresh
  const gitBranches = await Promise.all(
    processes.map((proc) => {
      const prev = previous.get(proc.pid);
      return (refreshGit || !prev)
        ? deps.getGitBranch(proc.cwd)
        : Promise.resolve(prev.gitBranch);
    }),
  );

  const activePids = new Set<number>();
  const sessions: AgentSession[] = [];

  for (let pi = 0; pi < processes.length; pi++) {
    const proc = processes[pi];
    activePids.add(proc.pid);
    const content = contents.get(proc.tty) || '';
    let {activity, statusText, lastPrompt, lastResponse} = parseTerminalState(content);

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

    const gitBranch = gitBranches[pi];

    // Cache prompt and response across polls so they survive when content
    // scrolls out of the terminal history window.  Clear the cached response
    // whenever a new prompt arrives (the old response is stale).
    const cachedPrompt = pollerState.lastKnownPrompts.get(proc.pid);
    if (lastPrompt) {
      if (lastPrompt !== cachedPrompt) {
        pollerState.lastKnownResponses.delete(proc.pid);
      }
      pollerState.lastKnownPrompts.set(proc.pid, lastPrompt);
    }
    if (lastResponse.length > 0) {
      pollerState.lastKnownResponses.set(proc.pid, lastResponse);
    }

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
      lastPrompt: pollerState.lastKnownPrompts.get(proc.pid) || '',
      lastResponse: pollerState.lastKnownResponses.get(proc.pid) || [],
    });
  }

  // Clean up state for dead processes
  const stateMaps = [
    pollerState.contentFingerprints,
    pollerState.lastKnownPrompts,
    pollerState.lastKnownResponses,
  ];
  for (const map of stateMaps) {
    for (const pid of map.keys()) {
      if (!activePids.has(pid)) map.delete(pid);
    }
  }

  // Sort by process start time (oldest first)
  sessions.sort((a, b) => a.processStartedAt - b.processStartedAt);
  return sessions;
}
