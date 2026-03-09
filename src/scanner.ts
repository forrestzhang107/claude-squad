import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {execSync} from 'node:child_process';
import type {DiscoveredSession} from './types.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MATCH_DELTA_MS = 60 * 1000; // 60s max delta for process-to-session matching


interface ClaudeProcess {
  pid: number;
  startTime: number;
}

/** Find all running claude processes with their start times. */
function getActiveClaudeProcesses(): ClaudeProcess[] {
  const processes: ClaudeProcess[] = [];
  try {
    const pids = execSync("ps -eo pid,comm | grep -w 'claude$' | awk '{print $1}'", {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);

    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      try {
        const lstart = execSync(`ps -o lstart= -p ${pid}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (lstart) {
          const startTime = new Date(lstart).getTime();
          if (startTime) processes.push({pid, startTime});
        }
      } catch {
        // Process may have exited
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
 * Find all SessionStart hook timestamps in a JSONL file.
 * A file can have multiple SessionStarts when sessions are resumed via --resume.
 * Each SessionStart fires within seconds of a process starting, so matching
 * these against process start times identifies which process is using this file.
 * Falls back to file birth time if no hooks are found.
 *
 * Results are cached by file path + size since SessionStart hooks are immutable
 * (they're only appended, never modified). The cache is invalidated when the
 * file grows, at which point only the new bytes are scanned.
 */
interface SessionStartCache {
  size: number;
  timestamps: number[];
}

const sessionStartCache = new Map<string, SessionStartCache>();

function getSessionStartTimes(jsonlFile: string, fileBirthMs: number): number[] {
  let fileSize: number;
  try {
    fileSize = fs.statSync(jsonlFile).size;
  } catch {
    return [fileBirthMs];
  }

  const cached = sessionStartCache.get(jsonlFile);
  if (cached && cached.size === fileSize) {
    return cached.timestamps.length > 0 ? cached.timestamps : [fileBirthMs];
  }

  // Read only the new bytes if we have a partial cache
  const offset = cached ? cached.size : 0;
  const timestamps = cached ? [...cached.timestamps] : [];

  try {
    const readSize = fileSize - offset;
    if (readSize <= 0) {
      return timestamps.length > 0 ? timestamps : [fileBirthMs];
    }

    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(jsonlFile, 'r');
    try {
      fs.readSync(fd, buf, 0, readSize, offset);
    } finally {
      fs.closeSync(fd);
    }

    for (const line of buf.toString('utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (
          record.type === 'progress' &&
          record.data?.type === 'hook_progress' &&
          record.data?.hookEvent === 'SessionStart'
        ) {
          const ts = new Date(record.timestamp).getTime();
          if (ts > 0) timestamps.push(ts);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File read error
  }

  sessionStartCache.set(jsonlFile, {size: fileSize, timestamps});
  return timestamps.length > 0 ? timestamps : [fileBirthMs];
}

/**
 * Match sessions to processes by correlating SessionStart hook timestamps
 * with process start times. A JSONL file can have multiple SessionStart hooks
 * (from --resume), so we consider ALL of them and pick the best pairing.
 *
 * Uses greedy closest-match: sorts all (session, timestamp, process) triples
 * by time delta, then greedily assigns the best unused pair.
 */
function matchProcesses(
  sessions: DiscoveredSession[],
  processes: ClaudeProcess[],
): void {
  if (sessions.length === 0 || processes.length === 0) return;

  // Collect all SessionStart timestamps for each session
  const sessionTimesMap = new Map<string, number[]>();
  for (const s of sessions) {
    sessionTimesMap.set(s.sessionId, getSessionStartTimes(s.jsonlFile, s.createdAt));
  }

  // Build candidate pairs using ALL timestamps per session
  const pairs: Array<{session: DiscoveredSession; proc: ClaudeProcess; delta: number}> = [];
  for (const s of sessions) {
    const times = sessionTimesMap.get(s.sessionId)!;
    for (const proc of processes) {
      // Use the timestamp closest to this process's start time
      let bestDelta = Infinity;
      for (const t of times) {
        const d = Math.abs(t - proc.startTime);
        if (d < bestDelta) bestDelta = d;
      }
      pairs.push({session: s, proc, delta: bestDelta});
    }
  }
  pairs.sort((a, b) => a.delta - b.delta);

  // Greedy closest-match (reject pairs with delta > 60s to avoid spurious matches)
  const usedSessions = new Set<string>();
  const usedPids = new Set<number>();
  for (const {session, proc, delta} of pairs) {
    if (delta > MAX_MATCH_DELTA_MS) break; // sorted by delta, all remaining are worse
    if (usedSessions.has(session.sessionId) || usedPids.has(proc.pid)) continue;
    session.pid = proc.pid;
    session.processStartedAt = proc.startTime;
    usedSessions.add(session.sessionId);
    usedPids.add(proc.pid);
  }
}

export function scanSessions(options: {
  showAll?: boolean;
  projectFilter?: string;
}): DiscoveredSession[] {
  const {showAll, projectFilter} = options;
  const now = Date.now();
  const sessions: DiscoveredSession[] = [];

  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return [];
  }

  for (const dirName of projectDirs) {
    const projectName = extractProjectName(dirName);

    if (projectFilter && !projectName.includes(projectFilter)) {
      continue;
    }

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

  // Match against all sessions first — a long-idle process may have a stale
  // file that would be excluded by the 24h filter. Matching first ensures
  // active processes always find their session.
  matchProcesses(sessions, processes);

  // Now filter: keep matched sessions (regardless of age) and recent unmatched ones
  const filtered = sessions.filter((s) => {
    if (showAll) return true;
    if (s.pid > 0) return true;
    return now - s.modifiedAt <= STALE_THRESHOLD_MS;
  });

  if (showAll) {
    // Deduplicate to one per project (prefer matched sessions, then most recent)
    filtered.sort((a, b) => {
      if (a.pid && !b.pid) return -1;
      if (!a.pid && b.pid) return 1;
      return b.modifiedAt - a.modifiedAt;
    });
    const seen = new Set<string>();
    const result = filtered.filter((s) => {
      if (seen.has(s.projectDir)) return false;
      seen.add(s.projectDir);
      return true;
    });
    result.sort((a, b) => (a.processStartedAt || Infinity) - (b.processStartedAt || Infinity));
    return result;
  }

  // Default: return only sessions matched to a running process
  const result = filtered.filter((s) => s.pid > 0);
  result.sort((a, b) => a.processStartedAt - b.processStartedAt);

  return result;
}
