import * as fs from 'node:fs';
import type {AgentSession, DiscoveredSession} from './types.js';
import {processLine} from './parser.js';

const POLL_INTERVAL_MS = 1000;

export function createSession(discovered: DiscoveredSession): AgentSession {
  return {
    sessionId: discovered.sessionId,
    projectDir: discovered.projectDir,
    projectName: discovered.projectName,
    jsonlFile: discovered.jsonlFile,
    gitBranch: '',
    activity: 'idle',
    statusText: 'Watching...',
    lastActivityAt: discovered.modifiedAt,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolNames: new Map(),
    hadToolsInTurn: false,
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

export function skipToEnd(session: AgentSession): void {
  try {
    const stat = fs.statSync(session.jsonlFile);
    session.fileOffset = stat.size;
  } catch {
    // ignore
  }
}

export function startWatching(
  session: AgentSession,
  onChange: () => void,
): () => void {
  skipToEnd(session);
  readLastLines(session);

  const interval = setInterval(() => {
    if (readNewLines(session)) {
      onChange();
    }
  }, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}

function readLastLines(session: AgentSession): void {
  try {
    const stat = fs.statSync(session.jsonlFile);
    const readSize = Math.min(stat.size, 8192);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(session.jsonlFile, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const text = buf.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      processLine(session, line);
    }

    session.fileOffset = stat.size;
  } catch {
    // ignore
  }
}
