import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {execSync} from 'node:child_process';
import type {DiscoveredSession} from './types.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Encode a filesystem path the same way Claude does for project directory names. */
function pathToDirName(fsPath: string): string {
  return fsPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Returns a map of session-id -> PID by parsing --resume args from claude processes,
 * and a map of encoded project-dir-name -> count of all active claude processes.
 */
function getActiveClaudeProcesses(): {
  sessionPids: Map<string, number>;
  dirPids: Map<string, number[]>;
} {
  const sessionPids = new Map<string, number>();
  const dirPids = new Map<string, number[]>();
  try {
    // Get all claude PIDs (bare "claude" processes, not substrings like "claude-squad")
    const pids = execSync("ps -eo pid,comm | grep -w 'claude$' | awk '{print $1}'", {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);

    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);

      // Check for --resume to get exact session ID mapping
      try {
        const args = execSync(`ps -o args= -p ${pid}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const match = args.match(/--resume[=\s]+([0-9a-f-]+)/);
        if (match) {
          sessionPids.set(match[1], pid);
        }
      } catch {
        // Process may have exited
      }

      // Resolve CWD for active-dir counting (all processes, not just --resume)
      try {
        const output = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n' | head -1`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (output) {
          const cwd = output.startsWith('n') ? output.slice(1) : output;
          const dirName = pathToDirName(cwd);
          if (!dirPids.has(dirName)) dirPids.set(dirName, []);
          dirPids.get(dirName)!.push(pid);
        }
      } catch {
        // Process may have exited
      }
    }
  } catch {
    // No claude processes
  }
  return {sessionPids, dirPids};
}

/** Check if the last record in a JSONL file is a last-prompt (session ended cleanly). */
function isSessionEnded(jsonlFile: string): boolean {
  try {
    const stat = fs.statSync(jsonlFile);
    const readSize = Math.min(stat.size, 4096);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(jsonlFile, 'r');
    try {
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    } finally {
      fs.closeSync(fd);
    }

    const text = buf.toString('utf-8');
    const lines = text.split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    if (!lastLine) return false;

    const record = JSON.parse(lastLine);
    return record.type === 'last-prompt';
  } catch {
    return false;
  }
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

/** Assign PIDs to sessions using exact session-ID matches. */
function assignPids(sessions: DiscoveredSession[], sessionPids: Map<string, number>): void {
  for (const s of sessions) {
    const pid = sessionPids.get(s.sessionId);
    if (pid !== undefined) {
      s.pid = pid;
    }
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
      });
    }
  }

  // Get active claude processes: exact session->PID mapping and per-dir PID lists
  const {sessionPids, dirPids} = getActiveClaudeProcesses();

  // Filter stale sessions, but keep all sessions for dirs with active processes
  // (a long-idle but still-running session shouldn't be excluded by age)
  const filtered = sessions.filter((s) => {
    if (showAll) return true;
    if (dirPids.has(s.projectDir)) return true;
    return now - s.modifiedAt <= STALE_THRESHOLD_MS;
  });

  // Sort by modifiedAt descending, but deprioritize ended sessions.
  // A closed session writes last-prompt as its final record, making its mtime
  // more recent than a long-idle but still-running session.
  // Only check sessions in dirs with active processes (where sort order matters).
  const endedSessions = new Set<string>();
  for (const s of filtered) {
    if (dirPids.has(s.projectDir) && isSessionEnded(s.jsonlFile)) {
      endedSessions.add(s.sessionId);
    }
  }
  filtered.sort((a, b) => {
    const aEnded = endedSessions.has(a.sessionId) ? 1 : 0;
    const bEnded = endedSessions.has(b.sessionId) ? 1 : 0;
    if (aEnded !== bEnded) return aEnded - bEnded; // non-ended first
    return b.modifiedAt - a.modifiedAt;
  });

  if (showAll) {
    // Show all, deduplicated to one per project (most recently modified wins)
    const seen = new Set<string>();
    const result = filtered.filter((s) => {
      if (seen.has(s.projectDir)) return false;
      seen.add(s.projectDir);
      return true;
    });
    assignPids(result, sessionPids);
    result.sort((a, b) => a.createdAt - b.createdAt);
    return result;
  }

  // For each active dir, keep N most recently modified sessions (N = process count).
  // Sessions are already sorted by modifiedAt desc, so first N per dir are the active ones.
  // Assign exact PIDs by session ID where possible, fall back to dir-based assignment.
  const result: DiscoveredSession[] = [];
  const pidQueues = new Map<string, number[]>();
  for (const [dirName, pids] of dirPids) {
    pidQueues.set(dirName, [...pids]);
  }

  for (const s of filtered) {
    const queue = pidQueues.get(s.projectDir);
    if (queue && queue.length > 0) {
      const exactPid = sessionPids.get(s.sessionId);
      if (exactPid !== undefined && queue.includes(exactPid)) {
        s.pid = exactPid;
        queue.splice(queue.indexOf(exactPid), 1);
      } else {
        s.pid = queue.shift()!;
      }
      result.push(s);
    }
  }

  result.sort((a, b) => a.createdAt - b.createdAt);

  return result;
}
