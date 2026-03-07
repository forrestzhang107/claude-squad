import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {DiscoveredSession} from './types.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function extractProjectName(dirName: string): string {
  const parts = dirName.split('-').filter(Boolean);
  const reposIdx = parts.findIndex(
    (p) => p.toLowerCase() === 'repos',
  );
  if (reposIdx >= 0 && reposIdx < parts.length - 1) {
    return parts.slice(reposIdx + 1).join('-');
  }
  return parts.slice(-1)[0] || dirName;
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

  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (seen.has(s.projectDir)) return false;
    seen.add(s.projectDir);
    return true;
  });
}
