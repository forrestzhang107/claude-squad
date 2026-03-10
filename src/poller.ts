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
 * Batch-read visible terminal content for given TTYs from Terminal.app.
 * Uses `contents of tab` (visible screen only, not scrollback history).
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
              set output to output & ttyName & "${SEPARATOR}" & (contents of t) & "${SEPARATOR}${SEPARATOR}"
            end if
          end repeat
        end repeat
        return output
      end tell
    `;
    const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      maxBuffer: 1024 * 1024,
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
const TOOL_LINE_RE = /^⏺ (\w[\w:.-]*)\((.*)?\)\s*$/;
const THINKING_RE = /^⏺ Thinking[.…]/;
const BASH_CMD_MAX = 40;

interface TerminalState {
  activity: AgentActivity;
  statusText: string;
}

/** Parse visible terminal content into an activity state. */
export function parseTerminalState(content: string): TerminalState {
  if (!content || !content.trim()) {
    return {activity: 'waiting', statusText: 'Waiting for input'};
  }

  // 1. Permission — highest priority (check last 2000 chars)
  const tail = content.slice(-2000);
  if (PERMISSION_RE.test(tail)) {
    return {activity: 'permission', statusText: 'Needs permission'};
  }

  // 2. Waiting — Claude's input prompt at end of screen
  const lastLines = tail.split('\n').slice(-5);
  if (lastLines.some((line) => /^>\s*$/.test(line))) {
    return {activity: 'waiting', statusText: 'Waiting for input'};
  }

  // 3. Find the last ⏺ line to determine current activity
  const allLines = content.split('\n');
  let lastToolLine: RegExpMatchArray | null = null;
  let lastBulletIsText = false;
  let lastBulletIsThinking = false;

  for (let i = allLines.length - 1; i >= 0; i--) {
    const line = allLines[i].trim();
    if (!line.startsWith('⏺')) continue;

    // Check for thinking indicator
    if (THINKING_RE.test(line)) {
      lastBulletIsThinking = true;
      break;
    }

    const toolMatch = line.match(TOOL_LINE_RE);
    if (toolMatch) {
      lastToolLine = toolMatch;
      break;
    }
    // It's a ⏺ line but not a tool invocation — it's response text
    if (line.length > 2) {
      lastBulletIsText = true;
      break;
    }
  }

  // 4. Thinking — model is reasoning
  if (lastBulletIsThinking) {
    return {activity: 'thinking', statusText: 'Thinking...'};
  }

  // 5. Tool active — determine specific activity from tool name
  if (lastToolLine) {
    const toolName = lastToolLine[1];
    const args = lastToolLine[2] || '';
    return mapToolToState(toolName, args);
  }

  // 6. Responding — last ⏺ line is text
  if (lastBulletIsText) {
    return {activity: 'active', statusText: 'Responding...'};
  }

  // 7. Fallback — something is on screen but unclear
  return {activity: 'active', statusText: 'Working...'};
}

function mapToolToState(toolName: string, args: string): TerminalState {
  switch (toolName) {
    case 'Read':
      return {activity: 'reading', statusText: `Reading ${args}`};
    case 'Edit':
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
    case 'Agent':
    case 'Task':
      return {activity: 'running', statusText: 'Running subtask'};
    default:
      return {activity: 'active', statusText: `Using ${toolName}`};
  }
}
