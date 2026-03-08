import * as fs from 'node:fs';
import * as path from 'node:path';
const BASH_CMD_MAX = 40;
const MAX_HISTORY = 4;
const MIN_TASK_LENGTH = 20;
const MAX_RECENT_PATHS = 20;
// Strip emoji and other wide Unicode characters that break terminal column alignment
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{231A}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25FE}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
function stripEmoji(text) {
    return text.replace(EMOJI_RE, '');
}
function findGitRoot(dir) {
    let current = dir;
    while (current !== '/') {
        try {
            const gitPath = path.join(current, '.git');
            if (fs.existsSync(gitPath))
                return current;
        }
        catch {
            // ignore
        }
        current = path.dirname(current);
    }
    return '';
}
function parseRepoName(gitRoot) {
    try {
        const configPath = path.join(gitRoot, '.git', 'config');
        const config = fs.readFileSync(configPath, 'utf-8');
        const match = config.match(/url\s*=\s*.*[/:]([^/]+\/[^/]+?)(?:\.git)?\s*$/m);
        if (match)
            return match[1].split('/').pop() || match[1]; // e.g. "claude-squad"
    }
    catch {
        // ignore
    }
    return '';
}
function extractDir(filePath) {
    if (typeof filePath !== 'string' || !filePath.startsWith('/'))
        return '';
    return path.dirname(filePath);
}
function detectWorkingDirectory(paths) {
    if (paths.length === 0)
        return '';
    // Count directory frequency
    const counts = new Map();
    for (const p of paths) {
        // Walk up the path and count each ancestor
        let dir = p;
        while (dir !== '/' && dir) {
            counts.set(dir, (counts.get(dir) || 0) + 1);
            dir = path.dirname(dir);
        }
    }
    // Find the deepest directory that appears in most paths
    let best = '';
    let bestScore = 0;
    for (const [dir, count] of counts) {
        // Score = frequency * depth (prefer deeper, common directories)
        const depth = dir.split('/').length;
        const score = count * depth;
        if (score > bestScore) {
            bestScore = score;
            best = dir;
        }
    }
    return best;
}
function formatToolStatus(toolName, input) {
    const base = (p) => typeof p === 'string' ? path.basename(p) : '';
    switch (toolName) {
        case 'Read':
            return { activity: 'reading', statusText: `Reading ${base(input.file_path)}`, file: base(input.file_path) };
        case 'Edit':
            return { activity: 'editing', statusText: `Editing ${base(input.file_path)}`, file: base(input.file_path) };
        case 'Write':
            return { activity: 'editing', statusText: `Writing ${base(input.file_path)}`, file: base(input.file_path) };
        case 'Bash': {
            const cmd = stripEmoji(input.command || '');
            const truncated = cmd.length > BASH_CMD_MAX ? cmd.slice(0, BASH_CMD_MAX) + '...' : cmd;
            return { activity: 'running', statusText: `$ ${truncated}` };
        }
        case 'Glob':
        case 'Grep':
            return { activity: 'searching', statusText: 'Searching codebase' };
        case 'WebFetch':
        case 'WebSearch':
            return { activity: 'searching', statusText: 'Searching the web' };
        case 'Agent':
        case 'Task':
            return { activity: 'running', statusText: 'Running subtask' };
        default:
            return { activity: 'active', statusText: `Using ${toolName}` };
    }
}
function addHistory(session, tool, status) {
    session.toolHistory.push({ tool, status, timestamp: Date.now() });
    if (session.toolHistory.length > MAX_HISTORY) {
        session.toolHistory.shift();
    }
}
export function processLine(session, line) {
    let changed = false;
    try {
        const record = JSON.parse(line);
        // Capture session start time from the first timestamped record
        if (record.timestamp && !session.sessionStartedAt) {
            const ts = new Date(record.timestamp).getTime();
            if (ts > 0) {
                session.sessionStartedAt = ts;
                changed = true;
            }
        }
        if (record.gitBranch && record.gitBranch !== session.gitBranch) {
            session.gitBranch = record.gitBranch;
            changed = true;
        }
        if (record.type === 'assistant' &&
            Array.isArray(record.message?.content)) {
            // Extract context window usage from the API response.
            // Total context = input_tokens + cache_read + cache_creation (input_tokens alone is just the non-cached portion)
            const usage = record.message?.usage;
            if (usage && typeof usage.input_tokens === 'number') {
                session.contextTokens =
                    (usage.input_tokens || 0) +
                        (usage.cache_read_input_tokens || 0) +
                        (usage.cache_creation_input_tokens || 0);
                changed = true;
            }
            const blocks = record.message.content;
            const toolUses = blocks.filter((b) => b.type === 'tool_use');
            if (toolUses.length > 0) {
                session.hadToolsInTurn = true;
                for (const tool of toolUses) {
                    const toolName = tool.name || '';
                    const { activity, statusText, file } = formatToolStatus(toolName, tool.input || {});
                    if (file) {
                        session.currentFile = file;
                    }
                    // Collect file paths for working directory detection
                    const input = tool.input || {};
                    const dir = extractDir(input.file_path) || extractDir(input.path);
                    if (dir) {
                        session.recentPaths.push(dir);
                        if (session.recentPaths.length > MAX_RECENT_PATHS) {
                            session.recentPaths.shift();
                        }
                        const detected = detectWorkingDirectory(session.recentPaths);
                        if (detected && detected !== session.workingDirectory) {
                            session.workingDirectory = detected;
                            const gitRoot = findGitRoot(detected);
                            if (gitRoot) {
                                session.repoName = parseRepoName(gitRoot) || path.basename(gitRoot);
                            }
                            changed = true;
                        }
                    }
                    // Track subagents
                    if (toolName === 'Agent' || toolName === 'Task') {
                        session.activeSubagents++;
                    }
                    if (tool.id) {
                        session.activeToolIds.add(tool.id);
                        session.activeToolNames.set(tool.id, toolName);
                        session.toolUseTimestamps.set(tool.id, Date.now());
                    }
                    // Use the last tool for display status
                    session.activity = activity;
                    session.statusText = statusText;
                    addHistory(session, toolName, statusText);
                }
                session.lastActivityAt = Date.now();
                changed = true;
            }
            else if (blocks.some((b) => b.type === 'thinking')) {
                session.activity = 'thinking';
                session.statusText = 'Thinking...';
                session.lastActivityAt = Date.now();
                changed = true;
            }
            else if (blocks.some((b) => b.type === 'text') &&
                !session.hadToolsInTurn) {
                session.activity = 'active';
                session.statusText = 'Responding...';
                session.lastActivityAt = Date.now();
                changed = true;
            }
        }
        else if (record.type === 'user') {
            const content = record.message?.content;
            if (Array.isArray(content)) {
                const hasToolResult = content.some((b) => b.type === 'tool_result');
                if (hasToolResult) {
                    for (const block of content) {
                        if (block.type === 'tool_result' && block.tool_use_id) {
                            // Track subagent completion
                            const toolName = session.activeToolNames.get(block.tool_use_id);
                            if (toolName === 'Agent' || toolName === 'Task') {
                                session.activeSubagents = Math.max(0, session.activeSubagents - 1);
                            }
                            session.activeToolIds.delete(block.tool_use_id);
                            session.activeToolNames.delete(block.tool_use_id);
                            session.toolUseTimestamps.delete(block.tool_use_id);
                        }
                    }
                    if (session.activeToolIds.size === 0) {
                        session.hadToolsInTurn = false;
                    }
                    // Clear permission state once tool results arrive
                    if (session.activity === 'permission') {
                        session.activity = 'active';
                        session.statusText = 'Working...';
                    }
                    changed = true;
                }
                else {
                    // New user prompt (array form with text blocks)
                    const text = content
                        .filter((b) => b.type === 'text')
                        .map((b) => b.text || '')
                        .join(' ')
                        .trim();
                    if (text.length >= MIN_TASK_LENGTH) {
                        session.taskSummary = stripEmoji(text);
                    }
                    session.activity = 'active';
                    session.statusText = 'Starting...';
                    session.activeToolIds.clear();
                    session.activeToolNames.clear();
                    session.toolUseTimestamps.clear();
                    session.activeSubagents = 0;
                    session.hadToolsInTurn = false;
                    session.lastActivityAt = Date.now();
                    changed = true;
                }
            }
            else if (typeof content === 'string' && content.trim()) {
                if (content.trim().length >= MIN_TASK_LENGTH) {
                    session.taskSummary = stripEmoji(content.trim());
                }
                session.activity = 'active';
                session.statusText = 'Starting...';
                session.activeToolIds.clear();
                session.activeToolNames.clear();
                session.toolUseTimestamps.clear();
                session.activeSubagents = 0;
                session.hadToolsInTurn = false;
                session.lastActivityAt = Date.now();
                changed = true;
            }
        }
        else if (record.type === 'system' &&
            record.subtype === 'turn_duration') {
            session.activity = 'waiting';
            session.statusText = 'Waiting for input';
            session.activeToolIds.clear();
            session.activeToolNames.clear();
            session.toolUseTimestamps.clear();
            session.activeSubagents = 0;
            session.hadToolsInTurn = false;
            changed = true;
        }
        else if (record.type === 'progress') {
            const data = record.data;
            const dataType = data?.type;
            if (dataType === 'tool_permission_request') {
                session.activity = 'permission';
                session.statusText = 'Needs permission';
                session.lastActivityAt = Date.now();
                changed = true;
            }
            else if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
                // Tool is running — permission was granted, clear permission state
                if (session.activity === 'permission') {
                    session.activity = 'running';
                    session.statusText = 'Running...';
                    changed = true;
                }
                // Reset all timestamps to restart the permission timer
                const now = Date.now();
                for (const id of session.toolUseTimestamps.keys()) {
                    session.toolUseTimestamps.set(id, now);
                }
            }
        }
    }
    catch {
        // Ignore malformed lines
    }
    return changed;
}
//# sourceMappingURL=parser.js.map