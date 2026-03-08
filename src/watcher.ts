import * as fs from 'node:fs';
import type {AgentSession, DiscoveredSession} from './types.js';
import {processLine} from './parser.js';

const POLL_INTERVAL_MS = 1000;
const PERMISSION_TIMEOUT_MS = 7000;
const IDLE_TIMEOUT_MS = 10000; // 10s with no file changes → waiting
const PERMISSION_EXEMPT_TOOLS = new Set(['Agent', 'Task', 'AskUserQuestion', 'Skill']);

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
      session.activity !== 'stale'
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

    // Idle timeout: transition to waiting when the JSONL file stops updating.
    // - Tool states (reading, editing, etc.) with no active tools: 10s
    // - 'active' with respondedAt set (text record seen): 10s
    //   (respondedAt distinguishes "Responding..." from "Starting...")
    // - 'active' without respondedAt / 'thinking': no timeout (model is
    //   mid-generation, JSONL won't update until response is complete)
    if (
      !changed &&
      session.activity !== 'waiting' &&
      session.activity !== 'stale' &&
      session.activity !== 'permission'
    ) {
      if (canIdleTimeout(session)) {
        try {
          const stat = fs.statSync(session.jsonlFile);
          if (Date.now() - stat.mtimeMs > IDLE_TIMEOUT_MS) {
            session.activity = 'waiting';
            session.statusText = 'Waiting for input';
            session.hadToolsInTurn = false;
            session.respondedAt = 0;
            changed = true;
          }
        } catch {
          // ignore
        }
      }
    }

    if (changed) {
      onChange();
    }
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}

const STALE_ACTIVITY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Whether the session's current state can transition to 'waiting' via idle timeout.
 * 'active' with respondedAt > 0 ("Responding...") can timeout, but 'active' with
 * respondedAt === 0 ("Starting...") and 'thinking' cannot -- the model is mid-generation
 * and the JSONL won't update until the response is complete.
 */
function canIdleTimeout(session: AgentSession): boolean {
  if (session.activity === 'active') return session.respondedAt > 0;
  return session.activity !== 'thinking' && session.activeToolIds.size === 0;
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
    if (age > STALE_ACTIVITY_MS) {
      session.activity = 'stale';
      session.statusText = 'Inactive';
    } else if (age > IDLE_TIMEOUT_MS && canIdleTimeout(session)) {
      session.activity = 'waiting';
      session.statusText = 'Waiting for input';
    }

    session.fileOffset = stat.size;
  } catch {
    // ignore
  }
}
