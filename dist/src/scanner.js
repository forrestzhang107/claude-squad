import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
/** Encode a filesystem path the same way Claude does for project directory names. */
function pathToDirName(fsPath) {
    return fsPath.replace(/[^a-zA-Z0-9-]/g, '-');
}
/**
 * Returns a map of encoded project-dir-name -> number of active claude processes.
 * Uses the same encoding Claude uses (replace non-alphanumeric with '-') so we can
 * match directly against the directory names under ~/.claude/projects/.
 */
function getActiveClaudeDirs() {
    const counts = new Map();
    try {
        const pids = execSync("ps -eo pid,comm | grep -w 'claude$' | awk '{print $1}'", {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim().split('\n').filter(Boolean);
        for (const pid of pids) {
            try {
                const output = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n' | head -1`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                }).trim();
                if (output) {
                    const cwd = output.startsWith('n') ? output.slice(1) : output;
                    const dirName = pathToDirName(cwd);
                    counts.set(dirName, (counts.get(dirName) || 0) + 1);
                }
            }
            catch {
                // Process may have exited
            }
        }
    }
    catch {
        // No claude processes
    }
    return counts;
}
export function extractProjectName(dirName) {
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
        }
        catch {
            // doesn't exist, keep buffering
        }
    }
    return buffer || path.basename(resolved);
}
export function scanSessions(options) {
    const { showAll, projectFilter } = options;
    const now = Date.now();
    const sessions = [];
    let projectDirs;
    try {
        projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
    }
    catch {
        return [];
    }
    for (const dirName of projectDirs) {
        const projectName = extractProjectName(dirName);
        if (projectFilter && !projectName.includes(projectFilter)) {
            continue;
        }
        const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);
        let stat;
        try {
            stat = fs.statSync(dirPath);
        }
        catch {
            continue;
        }
        if (!stat.isDirectory())
            continue;
        let files;
        try {
            files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
        }
        catch {
            continue;
        }
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            let fileStat;
            try {
                fileStat = fs.statSync(filePath);
            }
            catch {
                continue;
            }
            if (!showAll && now - fileStat.mtimeMs > STALE_THRESHOLD_MS) {
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
            });
        }
    }
    // Sort by modifiedAt descending so we always prefer the most recently written files
    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
    if (showAll) {
        // Show all, deduplicated to one per project (most recently modified wins)
        const seen = new Set();
        const all = sessions.filter((s) => {
            if (seen.has(s.projectDir))
                return false;
            seen.add(s.projectDir);
            return true;
        });
        all.sort((a, b) => a.createdAt - b.createdAt);
        return all;
    }
    // Get active claude process directories (encoded as project-dir-names)
    const activeDirCounts = getActiveClaudeDirs();
    // For each active dir, keep N most recently modified sessions (N = process count).
    // Matching is done on the encoded dir name directly — no lossy path reconstruction.
    const result = [];
    const allowance = new Map();
    for (const [dirName, count] of activeDirCounts) {
        allowance.set(dirName, count);
    }
    // sessions are sorted by modifiedAt desc, so first N per dir are the active ones
    for (const s of sessions) {
        const remaining = allowance.get(s.projectDir);
        if (remaining !== undefined && remaining > 0) {
            result.push(s);
            allowance.set(s.projectDir, remaining - 1);
        }
    }
    result.sort((a, b) => a.createdAt - b.createdAt);
    return result;
}
//# sourceMappingURL=scanner.js.map