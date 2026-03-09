import * as fs from 'node:fs';
import type {AgentSession, DiscoveredSession} from './types.js';
import {processLine} from './parser.js';

const POLL_INTERVAL_MS = 1000;
const PERMISSION_TIMEOUT_MS = 7000;
const INACTIVE_TIMEOUT_MS = 60 * 60 * 1000; // 60m with no file changes → inactive
const PERMISSION_EXEMPT_TOOLS = new Set(['Agent', 'Task', 'AskUserQuestion', 'Skill']);

function applyInactiveTransition(session: AgentSession, ageMs: number): boolean {
  if (ageMs > INACTIVE_TIMEOUT_MS && session.activity !== 'inactive') {
    session.activity = 'inactive';
    session.statusText = 'Inactive';
    return true;
  }
  return false;
}

export function createSession(discovered: DiscoveredSession): AgentSession {
  return {
    sessionId: discovered.sessionId,
    projectDir: discovered.projectDir,
    projectName: discovered.projectName,
    jsonlFile: discovered.jsonlFile,
    gitBranch: '',
    activity: 'waiting',
    statusText: 'Waiting for input',
    lastActivityAt: discovered.modifiedAt,
    sessionStartedAt: 0,
    processStartedAt: discovered.processStartedAt,
    currentFile: '',
    toolHistory: [],
    activeSubagents: 0,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolNames: new Map(),
    toolUseTimestamps: new Map(),
    hadToolsInTurn: false,
    respondedAt: 0,
    pendingSubagentToolIds: new Set(),
    subagentToolTimestamps: new Map(),
    taskSummary: '',
    workingDirectory: '',
    repoName: '',
    recentPaths: [],
    contextTokens: 0,
    contextMaxTokens: 200000,
    lastResponseText: '',
    pid: discovered.pid,
  };
}

export function readNewLines(session: AgentSession): boolean {
  let changed = false;
  try {
    const stat = fs.statSync(session.jsonlFile);
    if (stat.size <= session.fileOffset) return false;

    const buf = Buffer.alloc(stat.size - session.fileOffset);
    const fd = fs.openSync(session.jsonlFile, 'r');
    fs.readSync(fd, buf, 0, buf.length, session.fileOffset);
    fs.closeSync(fd);
    session.fileOffset = stat.size;

    const text = session.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    session.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      if (processLine(session, line)) {
        changed = true;
      }
    }
  } catch {
    // File may have been deleted or rotated
  }
  return changed;
}

export function startWatching(
  session: AgentSession,
  onChange: () => void,
): () => void {
  readFullFile(session);

  const interval = setInterval(() => {
    let changed = readNewLines(session);

    // If tools are active (direct or subagent) and we're not already showing
    // permission state, check if any tool has been waiting long enough
    if (
      (session.activeToolIds.size > 0 || session.pendingSubagentToolIds.size > 0) &&
      session.activity !== 'permission' &&
      session.activity !== 'waiting' &&
      session.activity !== 'inactive'
    ) {
      const now = Date.now();
      let needsPermission = false;

      // Check non-exempt tools (direct tool calls)
      for (const [id, timestamp] of session.toolUseTimestamps) {
        const toolName = session.activeToolNames.get(id);
        if (PERMISSION_EXEMPT_TOOLS.has(toolName || '')) continue;
        if (now - timestamp >= PERMISSION_TIMEOUT_MS) {
          needsPermission = true;
          break;
        }
      }

      // Check subagent tools — pending tool_use with no tool_result for 7s
      if (!needsPermission) {
        for (const [, timestamp] of session.subagentToolTimestamps) {
          if (now - timestamp >= PERMISSION_TIMEOUT_MS) {
            needsPermission = true;
            break;
          }
        }
      }

      if (needsPermission) {
        session.activity = 'permission';
        session.statusText = 'Requesting permission';
        changed = true;
      }
    }

    // Inactive transition: 60m with no file changes → inactive
    if (!changed && session.activity !== 'permission') {
      try {
        const stat = fs.statSync(session.jsonlFile);
        const age = Date.now() - stat.mtimeMs;
        changed = applyInactiveTransition(session, age);
      } catch {
        // ignore
      }
    }

    if (changed) {
      onChange();
    }
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}

function readFullFile(session: AgentSession): void {
  try {
    const text = fs.readFileSync(session.jsonlFile, 'utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      processLine(session, line);
    }

    const stat = fs.statSync(session.jsonlFile);
    const age = Date.now() - stat.mtimeMs;
    applyInactiveTransition(session, age);

    session.fileOffset = stat.size;
  } catch {
    // ignore
  }
}
