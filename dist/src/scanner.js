import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
function getActiveClaudeDirs() {
    const counts = new Map();
    try {
        const pids = execSync("ps -eo pid,comm | grep -w 'claude$' | awk '{print $1}'", {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim().split('\n').filter(Boolean);
        for (const pid of pids) {
            try {
                const output = execSync(`lsof -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n'`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                }).trim();
                if (output) {
                    const cwd = output.startsWith('n') ? output.slice(1) : output;
                    counts.set(cwd, (counts.get(cwd) || 0) + 1);
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
function dirNameToPath(dirName) {
    // Reconstruct the actual filesystem path from the dir name
    const home = os.homedir();
    const homePrefix = home.replace(/[^a-zA-Z0-9-]/g, '-');
    if (!dirName.startsWith(homePrefix))
        return '';
    const rest = dirName.slice(homePrefix.length + 1);
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
    // If buffer is non-empty, the remaining segments form the last path component
    return buffer ? path.join(resolved, buffer) : resolved;
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
            });
        }
    }
    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
    if (showAll) {
        // Show all, deduplicated to one per project
        const seen = new Set();
        return sessions.filter((s) => {
            if (seen.has(s.projectDir))
                return false;
            seen.add(s.projectDir);
            return true;
        });
    }
    // Build a map of active directory -> number of claude processes
    const activeDirCounts = getActiveClaudeDirs();
    if (activeDirCounts.size === 0) {
        // Fallback: no process info, show most recent per project
        const seen = new Set();
        return sessions.filter((s) => {
            if (seen.has(s.projectDir))
                return false;
            seen.add(s.projectDir);
            return true;
        });
    }
    // For each active dir, keep N most recent sessions (where N = process count)
    // Map session projectDir -> resolved filesystem path
    const result = [];
    const allowance = new Map(); // resolved path -> remaining slots
    for (const [dir, count] of activeDirCounts) {
        allowance.set(dir, count);
    }
    for (const s of sessions) {
        const sessionPath = dirNameToPath(s.projectDir);
        const remaining = allowance.get(sessionPath);
        if (remaining !== undefined && remaining > 0) {
            result.push(s);
            allowance.set(sessionPath, remaining - 1);
        }
    }
    return result;
}
//# sourceMappingURL=scanner.js.map