import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {execSync} from 'node:child_process';
import type {DiscoveredSession} from './types.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');


export interface ClaudeProcess {
  pid: number;
  startTime: number;
  tty?: string;
  projectDir?: string; // encoded CWD, e.g. "-Users-forrest-Repos-telvana"
}

/** Find all running claude processes with their start times, TTYs, and CWDs. */
function getActiveClaudeProcesses(): ClaudeProcess[] {
  const processes: ClaudeProcess[] = [];
  try {
    // Single ps call: get pid, lstart, tty, and comm in one shot.
    // comm is last so grep anchors to it.
    const lines = execSync("ps -eo pid,lstart,tty,comm | grep -w 'claude$'", {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);

    const pids: number[] = [];
    for (const line of lines) {
      // Format: "  74876 Sun Mar  8 07:05:50 2026     ttys001  claude"
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      // lstart is 5 tokens (e.g. "Sun Mar  8 07:05:50 2026"), tty is next, comm is last
      const lstartStr = parts.slice(1, 6).join(' ');
      const ttyPart = parts[6];
      const startTime = new Date(lstartStr).getTime();
      const tty = ttyPart && ttyPart !== '??' && /^ttys\d+$/.test(ttyPart) ? `/dev/${ttyPart}` : undefined;
      if (startTime) {
        processes.push({pid, startTime, tty});
        pids.push(pid);
      }
    }

    // Single lsof call for all CWDs at once
    if (pids.length > 0) {
      try {
        const lsofOutput = execSync(`lsof -a -d cwd -Fn -p ${pids.join(',')}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Parse lsof output: "p<pid>\nfcwd\nn<path>\n" repeating
        let currentPid = 0;
        for (const lsofLine of lsofOutput.split('\n')) {
          if (lsofLine.startsWith('p')) {
            currentPid = parseInt(lsofLine.slice(1), 10);
          } else if (lsofLine.startsWith('n') && currentPid) {
            const cwd = lsofLine.slice(1);
            const proc = processes.find((p) => p.pid === currentPid);
            if (proc) proc.projectDir = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
          }
        }
      } catch {
        // lsof failed — proceed without CWD info
      }
    }
  } catch {
    // No claude processes
  }
  return processes;
}

export function extractProjectName(dirName: string): string {
  // The dir name is the full path with non-alphanumeric chars replaced by '-'
  // e.g. "/Users/forrest/Repos/telvana/telvana-api" -> "-Users-forrest-Repos-telvana-telvana-api"
  // We resolve against the actual filesystem to find the real last path segment.
  const home = os.homedir();
  const homePrefix = home.replace(/[^a-zA-Z0-9-]/g, '-');

  if (!dirName.startsWith(homePrefix)) {
    const parts = dirName.split('-').filter(Boolean);
    return parts[parts.length - 1] || dirName;
  }

  const rest = dirName.slice(homePrefix.length + 1); // e.g. "Repos-telvana-telvana-api"
  const segments = rest.split('-');
  let resolved = home;
  let buffer = '';

  for (const seg of segments) {
    buffer = buffer ? buffer + '-' + seg : seg;
    const candidate = path.join(resolved, buffer);
    try {
      if (fs.statSync(candidate).isDirectory()) {
        resolved = candidate;
        buffer = '';
      }
    } catch {
      // doesn't exist, keep buffering
    }
  }

  return buffer || path.basename(resolved);
}

/**
 * Extract assistant response snippets from Terminal.app history text.
 * Responses are lines starting with ⏺. We take the first 30 characters
 * as a fuzzy-match snippet (the terminal strips markdown and wraps lines,
 * but the first ~30 chars are reliable for matching against JSONL content).
 * Filters out tool-use lines which are UI-rendered and don't appear in JSONL.
 */
// Matches tool invocations: "ToolName(args)", "prefix:ToolName(args)",
// "Read path", "Read N files", "Searched for N patterns", etc.
const TOOL_LINE_RE = /^[\w-]+(?::[\w-]+)?\(|^Read \S|^Searched for \d+/;
const SNIPPET_LENGTH = 30;
const MAX_SNIPPETS_TO_TRY = 5;

export function extractAssistantResponses(terminalText: string): string[] {
  if (!terminalText) return [];
  const responses: string[] = [];
  for (const line of terminalText.split('\n')) {
    if (line.startsWith('⏺ ')) {
      const response = line.slice(2).trim();
      if (!response) continue;
      if (TOOL_LINE_RE.test(response)) continue;
      if (response.endsWith('(ctrl+o to expand)')) continue;
      const snippet = response.slice(0, SNIPPET_LENGTH);
      if (snippet.length >= 10) responses.push(snippet);
    }
  }
  return responses;
}

/**
 * Match assistant response snippets (from terminal history) against JSONL file
 * tails to find which session they belong to. Returns the sessionId of the best
 * match, or null if no match.
 *
 * Reads the tail of each JSONL file and counts how many snippets appear in it.
 * Returns the first session that matches all snippets, or the session with the
 * most matches if no full match is found.
 */
export function matchSessionBySnippets(
  snippets: string[],
  sessions: DiscoveredSession[],
): string | null {
  if (snippets.length === 0 || sessions.length === 0) return null;

  const TAIL_BYTES = 32 * 1024; // Read last 32KB to reliably capture the latest assistant text

  let bestSession: string | null = null;
  let bestCount = 0;

  for (const session of sessions) {
    let tail: string;
    try {
      const stat = fs.statSync(session.jsonlFile);
      const size = stat.size;
      const readStart = Math.max(0, size - TAIL_BYTES);
      const readLen = size - readStart;
      const buf = Buffer.alloc(readLen);
      const fd = fs.openSync(session.jsonlFile, 'r');
      try {
        fs.readSync(fd, buf, 0, readLen, readStart);
      } finally {
        fs.closeSync(fd);
      }
      tail = buf.toString('utf-8');
    } catch {
      continue;
    }

    let matchCount = 0;
    for (const snippet of snippets) {
      if (tail.includes(snippet)) {
        matchCount++;
      }
    }

    if (matchCount > bestCount) {
      bestCount = matchCount;
      bestSession = session.sessionId;
      if (bestCount === snippets.length) break;
    } else if (matchCount === bestCount && matchCount > 0) {
      bestSession = null; // tie — ambiguous
    }
  }

  return bestSession;
}

/**
 * Read terminal history for specific TTYs from Terminal.app in a single AppleScript call.
 * Only reads tabs matching the given TTYs to minimize data transfer.
 */
function getTerminalHistories(ttys: string[]): Map<string, string> {
  const histories = new Map<string, string>();
  if (ttys.length === 0) return histories;

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
              set output to output & ttyName & "${SEPARATOR}" & (history of t) & "${SEPARATOR}${SEPARATOR}"
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
      maxBuffer: 10 * 1024 * 1024, // 10MB — terminal histories can be large
    });

    for (const chunk of raw.split(`${SEPARATOR}${SEPARATOR}`)) {
      const sepIdx = chunk.indexOf(SEPARATOR);
      if (sepIdx === -1) continue;
      const tty = chunk.slice(0, sepIdx).trim();
      const history = chunk.slice(sepIdx + SEPARATOR.length);
      if (tty) histories.set(tty, history);
    }
  } catch {
    // Terminal.app not running or AppleScript failed
  }

  return histories;
}

export interface ScanResult {
  sessions: DiscoveredSession[];
  activePids: Set<number>;
}

export function scanSessions(): ScanResult {
  const sessions: DiscoveredSession[] = [];

  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return {sessions: [], activePids: new Set()};
  }

  for (const dirName of projectDirs) {
    const projectName = extractProjectName(dirName);
    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let fileStat: fs.Stats;
      try {
        fileStat = fs.statSync(filePath);
      } catch {
        continue;
      }

      const sessionId = path.basename(file, '.jsonl');

      sessions.push({
        sessionId,
        projectDir: dirName,
        projectName,
        jsonlFile: filePath,
        modifiedAt: fileStat.mtimeMs,
        createdAt: fileStat.birthtimeMs,
        pid: 0,
        processStartedAt: 0,
      });
    }
  }

  const processes = getActiveClaudeProcesses();

  // TTY-based matching: read terminal history via AppleScript and match
  // assistant response snippets against JSONL file tails. This handles
  // /clear correctly since the terminal always shows the current session.
  const ttyProcesses = processes.filter((p) => p.tty);
  const ttys = ttyProcesses.map((p) => p.tty!);
  const terminalHistories = ttyProcesses.length > 0 ? getTerminalHistories(ttys) : new Map();

  // Pre-compute sessions by project directory, sorted by most recently modified
  const sessionsByDir = new Map<string, DiscoveredSession[]>();
  for (const s of sessions) {
    const existing = sessionsByDir.get(s.projectDir);
    if (existing) {
      existing.push(s);
    } else {
      sessionsByDir.set(s.projectDir, [s]);
    }
  }
  for (const group of sessionsByDir.values()) {
    group.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  for (const proc of ttyProcesses) {
    const history = terminalHistories.get(proc.tty!);
    if (!history) continue;

    const responses = extractAssistantResponses(history);
    if (responses.length === 0) continue;

    const candidates = (proc.projectDir && sessionsByDir.get(proc.projectDir)) || sessions;
    const unclaimed = candidates.filter((s) => s.pid === 0);
    if (unclaimed.length === 0) continue;

    // Try recent snippets in reverse order. The terminal may contain responses
    // from previous sessions (before /clear), so the latest snippet might match
    // an old file. Walk backwards to find one that matches a current file.
    const recentSnippets = responses.slice(-MAX_SNIPPETS_TO_TRY).reverse();
    for (const snippet of recentSnippets) {
      const matchedSessionId = matchSessionBySnippets([snippet], unclaimed);
      if (!matchedSessionId) continue;

      const targetSession = sessions.find((s) => s.sessionId === matchedSessionId);
      if (!targetSession) continue;

      targetSession.pid = proc.pid;
      targetSession.processStartedAt = proc.startTime;
      break;
    }
  }

  // Return matched sessions + all active PIDs (for Dashboard to detect exited processes)
  const matched = sessions.filter((s) => s.pid > 0);
  matched.sort((a, b) => a.processStartedAt - b.processStartedAt);
  const activePids = new Set(processes.map((p) => p.pid));

  return {sessions: matched, activePids};
}
