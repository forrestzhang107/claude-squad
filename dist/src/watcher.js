import * as fs from 'node:fs';
import { processLine } from './parser.js';
const POLL_INTERVAL_MS = 1000;
const PERMISSION_TIMEOUT_MS = 7000;
const IDLE_TIMEOUT_MS = 10000; // 10s with no file changes → waiting
const PERMISSION_EXEMPT_TOOLS = new Set(['Agent', 'Task', 'AskUserQuestion', 'Skill']);
export function createSession(discovered) {
    return {
        sessionId: discovered.sessionId,
        projectDir: discovered.projectDir,
        projectName: discovered.projectName,
        jsonlFile: discovered.jsonlFile,
        gitBranch: '',
        activity: 'waiting',
        statusText: 'Watching...',
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
        taskSummary: '',
        workingDirectory: '',
        repoName: '',
        recentPaths: [],
        contextTokens: 0,
        contextMaxTokens: 200000,
    };
}
export function readNewLines(session) {
    let changed = false;
    try {
        const stat = fs.statSync(session.jsonlFile);
        if (stat.size <= session.fileOffset)
            return false;
        const buf = Buffer.alloc(stat.size - session.fileOffset);
        const fd = fs.openSync(session.jsonlFile, 'r');
        fs.readSync(fd, buf, 0, buf.length, session.fileOffset);
        fs.closeSync(fd);
        session.fileOffset = stat.size;
        const text = session.lineBuffer + buf.toString('utf-8');
        const lines = text.split('\n');
        session.lineBuffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            if (processLine(session, line)) {
                changed = true;
            }
        }
    }
    catch {
        // File may have been deleted or rotated
    }
    return changed;
}
export function skipToEnd(session) {
    try {
        const stat = fs.statSync(session.jsonlFile);
        session.fileOffset = stat.size;
    }
    catch {
        // ignore
    }
}
export function startWatching(session, onChange) {
    skipToEnd(session);
    readFirstTimestamp(session);
    readLastLines(session);
    const interval = setInterval(() => {
        let changed = readNewLines(session);
        // If tools are active and we're not already showing permission state,
        // check if any tool has been waiting long enough to suggest permission prompt
        if (session.activeToolIds.size > 0 &&
            session.activity !== 'permission' &&
            session.activity !== 'waiting' &&
            session.activity !== 'stale') {
            const now = Date.now();
            let hasNonExempt = false;
            for (const [id, timestamp] of session.toolUseTimestamps) {
                const toolName = session.activeToolNames.get(id);
                if (PERMISSION_EXEMPT_TOOLS.has(toolName || ''))
                    continue;
                if (now - timestamp >= PERMISSION_TIMEOUT_MS) {
                    hasNonExempt = true;
                    break;
                }
            }
            if (hasNonExempt) {
                session.activity = 'permission';
                session.statusText = 'Requesting permission';
                changed = true;
            }
        }
        // If file hasn't changed and we're in a tool-related state, check for idle.
        // Don't timeout 'active' or 'thinking' — the model is mid-response and the
        // JSONL won't update until the full response is written. Only `turn_duration`
        // should end those states.
        if (!changed &&
            session.activity !== 'waiting' &&
            session.activity !== 'stale' &&
            session.activity !== 'permission' &&
            session.activity !== 'active' &&
            session.activity !== 'thinking' &&
            session.activeToolIds.size === 0) {
            try {
                const stat = fs.statSync(session.jsonlFile);
                if (Date.now() - stat.mtimeMs > IDLE_TIMEOUT_MS) {
                    session.activity = 'waiting';
                    session.statusText = 'Waiting for input';
                    session.hadToolsInTurn = false;
                    changed = true;
                }
            }
            catch {
                // ignore
            }
        }
        if (changed) {
            onChange();
        }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
}
const STALE_ACTIVITY_MS = 5 * 60 * 1000; // 5 minutes
function readFirstTimestamp(session) {
    try {
        // Read from the start of the file to find the earliest timestamp
        const fd = fs.openSync(session.jsonlFile, 'r');
        const buf = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);
        const text = buf.toString('utf-8', 0, bytesRead);
        for (const line of text.split('\n')) {
            if (!line.trim())
                continue;
            try {
                const record = JSON.parse(line);
                // Check top-level timestamp, then snapshot.timestamp as fallback
                const ts = record.timestamp || record.snapshot?.timestamp;
                if (ts) {
                    const ms = new Date(ts).getTime();
                    if (ms > 0) {
                        session.sessionStartedAt = ms;
                        return;
                    }
                }
            }
            catch {
                // malformed line, try next
            }
        }
    }
    catch {
        // ignore
    }
}
function readLastLines(session) {
    try {
        const stat = fs.statSync(session.jsonlFile);
        const readSize = Math.min(stat.size, 32768);
        const buf = Buffer.alloc(readSize);
        const fd = fs.openSync(session.jsonlFile, 'r');
        fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
        fs.closeSync(fd);
        const text = buf.toString('utf-8');
        const lines = text.split('\n');
        for (const line of lines) {
            if (!line.trim())
                continue;
            processLine(session, line);
        }
        // If the session hasn't been active recently, mark appropriately
        const age = Date.now() - stat.mtimeMs;
        if (age > STALE_ACTIVITY_MS) {
            session.activity = 'stale';
            session.statusText = 'Inactive';
        }
        else if (age > IDLE_TIMEOUT_MS && session.activeToolIds.size === 0) {
            session.activity = 'waiting';
            session.statusText = 'Waiting for input';
        }
        session.fileOffset = stat.size;
    }
    catch {
        // ignore
    }
}
//# sourceMappingURL=watcher.js.map