# claude-squad Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a shareable CLI tool that monitors all active Claude Code sessions and displays them as ASCII art characters in the terminal.

**Architecture:** Standalone Node.js CLI using Ink (React for terminal). Watches `~/.claude/projects/` for JSONL transcript files, parses them to detect agent states, renders a dashboard with ASCII characters. Published as an npm package.

**Tech Stack:** TypeScript, Ink 5, React 18, Node.js fs.watch/fs.watchFile

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `bin/cli.tsx`
- Create: `src/app.tsx`

**Step 1: Create package.json**

```json
{
  "name": "claude-squad",
  "version": "0.1.0",
  "description": "Terminal dashboard for monitoring Claude Code agent sessions",
  "type": "module",
  "bin": {
    "claude-squad": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/cli.js",
    "prepublishOnly": "npm run build"
  },
  "files": [
    "dist"
  ],
  "keywords": ["claude", "cli", "terminal", "dashboard", "agent"],
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "ink": "^5.1.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["bin", "src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
```

**Step 4: Create bin/cli.tsx**

```tsx
#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {App} from '../src/app.js';

const args = process.argv.slice(2);
const projectFilter = args.includes('--project')
  ? args[args.indexOf('--project') + 1]
  : undefined;
const showAll = args.includes('--all');

render(<App projectFilter={projectFilter} showAll={showAll} />);
```

**Step 5: Create src/app.tsx (minimal placeholder)**

```tsx
import React from 'react';
import {Box, Text} from 'ink';

interface AppProps {
  projectFilter?: string;
  showAll?: boolean;
}

export function App({projectFilter, showAll}: AppProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">claude-squad</Text>
      <Text dimColor>Scanning for active sessions...</Text>
    </Box>
  );
}
```

**Step 6: Install dependencies and verify build**

Run: `npm install && npm run build`
Expected: Compiles without errors, `dist/` created

**Step 7: Verify CLI runs**

Run: `node dist/cli.js`
Expected: Shows "claude-squad" and "Scanning for active sessions..."

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with Ink"
```

---

### Task 2: Session Scanner

**Files:**
- Create: `src/scanner.ts`
- Create: `src/types.ts`

**Step 1: Create src/types.ts**

```ts
export type AgentActivity =
  | 'idle'
  | 'active'
  | 'reading'
  | 'editing'
  | 'running'
  | 'searching'
  | 'permission'
  | 'thinking';

export interface AgentSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  gitBranch: string;
  activity: AgentActivity;
  statusText: string;
  lastActivityAt: number;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolNames: Map<string, string>;
  hadToolsInTurn: boolean;
}

export interface DiscoveredSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  modifiedAt: number;
}
```

**Step 2: Create src/scanner.ts**

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {DiscoveredSession} from './types.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function extractProjectName(dirName: string): string {
  // e.g. "-Users-forrest-Repos-telvana-telvana-api" -> "telvana-api"
  const parts = dirName.split('-').filter(Boolean);
  // Take the last meaningful segment(s)
  // Skip common path parts: Users, home dir name, Repos
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

  // Sort by most recently modified
  sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);

  // Deduplicate: keep only the most recent session per project
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (seen.has(s.projectDir)) return false;
    seen.add(s.projectDir);
    return true;
  });
}
```

**Step 3: Verify scanner finds sessions**

Temporarily add to `bin/cli.tsx`:
```ts
import {scanSessions} from '../src/scanner.js';
const sessions = scanSessions({showAll: false});
console.log(`Found ${sessions.length} sessions:`, sessions.map(s => s.projectName));
```

Run: `npm run build && node dist/cli.js`
Expected: Lists discovered project sessions from `~/.claude/projects/`

**Step 4: Remove temporary debug code from cli.tsx, commit**

```bash
git add -A
git commit -m "feat: session scanner discovers active Claude sessions"
```

---

### Task 3: JSONL Parser

**Files:**
- Create: `src/parser.ts`

This is the core logic ported from pixel-agents' `transcriptParser.ts`, adapted for our state model.

**Step 1: Create src/parser.ts**

```ts
import * as path from 'node:path';
import type {AgentActivity, AgentSession} from './types.js';

const BASH_CMD_MAX = 40;

function formatToolStatus(
  toolName: string,
  input: Record<string, unknown>,
): {activity: AgentActivity; statusText: string} {
  const base = (p: unknown) =>
    typeof p === 'string' ? path.basename(p) : '';

  switch (toolName) {
    case 'Read':
      return {activity: 'reading', statusText: `Reading ${base(input.file_path)}`};
    case 'Edit':
      return {activity: 'editing', statusText: `Editing ${base(input.file_path)}`};
    case 'Write':
      return {activity: 'editing', statusText: `Writing ${base(input.file_path)}`};
    case 'Bash': {
      const cmd = (input.command as string) || '';
      const truncated =
        cmd.length > BASH_CMD_MAX ? cmd.slice(0, BASH_CMD_MAX) + '...' : cmd;
      return {activity: 'running', statusText: `$ ${truncated}`};
    }
    case 'Glob':
    case 'Grep':
      return {activity: 'searching', statusText: 'Searching codebase'};
    case 'WebFetch':
    case 'WebSearch':
      return {activity: 'searching', statusText: 'Searching the web'};
    case 'Agent':
    case 'Task':
      return {activity: 'running', statusText: 'Running subtask'};
    default:
      return {activity: 'active', statusText: `Using ${toolName}`};
  }
}

export function processLine(session: AgentSession, line: string): boolean {
  let changed = false;
  try {
    const record = JSON.parse(line);

    // Extract git branch from any record that has it
    if (record.gitBranch && record.gitBranch !== session.gitBranch) {
      session.gitBranch = record.gitBranch;
      changed = true;
    }

    if (
      record.type === 'assistant' &&
      Array.isArray(record.message?.content)
    ) {
      const blocks = record.message.content as Array<{
        type: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;

      const toolUses = blocks.filter((b) => b.type === 'tool_use');

      if (toolUses.length > 0) {
        session.hadToolsInTurn = true;
        // Use the last tool_use for the display status
        const lastTool = toolUses[toolUses.length - 1]!;
        const toolName = lastTool.name || '';
        const {activity, statusText} = formatToolStatus(
          toolName,
          lastTool.input || {},
        );
        session.activity = activity;
        session.statusText = statusText;
        session.lastActivityAt = Date.now();

        for (const tool of toolUses) {
          if (tool.id) {
            session.activeToolIds.add(tool.id);
            session.activeToolNames.set(tool.id, tool.name || '');
          }
        }
        changed = true;
      } else if (blocks.some((b) => b.type === 'thinking')) {
        session.activity = 'thinking';
        session.statusText = 'Thinking...';
        session.lastActivityAt = Date.now();
        changed = true;
      } else if (
        blocks.some((b) => b.type === 'text') &&
        !session.hadToolsInTurn
      ) {
        session.activity = 'active';
        session.statusText = 'Responding...';
        session.lastActivityAt = Date.now();
        changed = true;
      }
    } else if (record.type === 'user') {
      const content = record.message?.content;
      if (Array.isArray(content)) {
        const hasToolResult = content.some(
          (b: {type: string}) => b.type === 'tool_result',
        );
        if (hasToolResult) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              session.activeToolIds.delete(block.tool_use_id);
              session.activeToolNames.delete(block.tool_use_id);
            }
          }
          if (session.activeToolIds.size === 0) {
            session.hadToolsInTurn = false;
          }
          changed = true;
        } else {
          // New user prompt — reset
          session.activity = 'active';
          session.statusText = 'Starting...';
          session.activeToolIds.clear();
          session.activeToolNames.clear();
          session.hadToolsInTurn = false;
          session.lastActivityAt = Date.now();
          changed = true;
        }
      } else if (typeof content === 'string' && content.trim()) {
        session.activity = 'active';
        session.statusText = 'Starting...';
        session.activeToolIds.clear();
        session.activeToolNames.clear();
        session.hadToolsInTurn = false;
        session.lastActivityAt = Date.now();
        changed = true;
      }
    } else if (
      record.type === 'system' &&
      record.subtype === 'turn_duration'
    ) {
      session.activity = 'idle';
      session.statusText = 'Waiting for input';
      session.activeToolIds.clear();
      session.activeToolNames.clear();
      session.hadToolsInTurn = false;
      changed = true;
    } else if (record.type === 'progress') {
      const data = record.data as Record<string, unknown> | undefined;
      if (data?.type === 'tool_permission_request') {
        session.activity = 'permission';
        session.statusText = 'Needs permission';
        session.lastActivityAt = Date.now();
        changed = true;
      }
    }
  } catch {
    // Ignore malformed lines
  }
  return changed;
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: JSONL transcript parser for agent state detection"
```

---

### Task 4: File Watcher

**Files:**
- Create: `src/watcher.ts`

**Step 1: Create src/watcher.ts**

```ts
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
  // Skip to end of file — only show new activity
  skipToEnd(session);

  // But read the last few lines to get current state (branch, etc.)
  readLastLines(session);

  // Poll for changes
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
    // Read last 8KB to find recent state
    const readSize = Math.min(stat.size, 8192);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(session.jsonlFile, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const text = buf.toString('utf-8');
    const lines = text.split('\n');

    // Process lines to pick up branch, last state
    for (const line of lines) {
      if (!line.trim()) continue;
      processLine(session, line);
    }

    // After catching up, keep file offset at end
    session.fileOffset = stat.size;
  } catch {
    // ignore
  }
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: file watcher reads JSONL changes incrementally"
```

---

### Task 5: ASCII Characters

**Files:**
- Create: `src/characters.ts`

**Step 1: Create src/characters.ts**

```ts
import type {AgentActivity} from './types.js';

interface CharacterFrame {
  art: string;
  label: string;
}

const characters: Record<AgentActivity, CharacterFrame> = {
  idle: {
    art: '(-_-)zzZ',
    label: 'Sleeping',
  },
  active: {
    art: '(^_^)',
    label: 'Working',
  },
  thinking: {
    art: '(o.o)...',
    label: 'Thinking',
  },
  reading: {
    art: '(o_o) ',
    label: 'Reading',
  },
  editing: {
    art: '(*_*)~',
    label: 'Editing',
  },
  running: {
    art: '(>_<)>',
    label: 'Running',
  },
  searching: {
    art: '(o_o)?',
    label: 'Searching',
  },
  permission: {
    art: '(o_o)!',
    label: 'Blocked',
  },
};

export function getCharacter(activity: AgentActivity): CharacterFrame {
  return characters[activity];
}

export function getActivityColor(activity: AgentActivity): string {
  switch (activity) {
    case 'idle':
      return 'gray';
    case 'active':
    case 'thinking':
      return 'cyan';
    case 'reading':
      return 'blue';
    case 'editing':
      return 'yellow';
    case 'running':
      return 'green';
    case 'searching':
      return 'magenta';
    case 'permission':
      return 'red';
  }
}
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: ASCII character art and color mappings"
```

---

### Task 6: Dashboard Components

**Files:**
- Create: `src/components/AgentCard.tsx`
- Create: `src/components/Dashboard.tsx`

**Step 1: Create src/components/AgentCard.tsx**

```tsx
import React from 'react';
import {Box, Text} from 'ink';
import {getCharacter, getActivityColor} from '../characters.js';
import type {AgentSession} from '../types.js';

interface AgentCardProps {
  session: AgentSession;
  width: number;
}

export function AgentCard({session, width}: AgentCardProps) {
  const character = getCharacter(session.activity);
  const color = getActivityColor(session.activity);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={color}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold>{session.projectName}</Text>
        {session.gitBranch ? (
          <Text dimColor>({session.gitBranch})</Text>
        ) : null}
      </Box>

      <Box justifyContent="center" marginY={1}>
        <Text color={color}>{character.art}</Text>
      </Box>

      <Text wrap="truncate">
        <Text color={color}>{session.statusText}</Text>
      </Text>
    </Box>
  );
}
```

**Step 2: Create src/components/Dashboard.tsx**

```tsx
import React, {useState, useEffect} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import {scanSessions} from '../scanner.js';
import {createSession, startWatching} from '../watcher.js';
import type {AgentSession} from '../types.js';
import {AgentCard} from './AgentCard.js';

interface DashboardProps {
  projectFilter?: string;
  showAll?: boolean;
}

const RESCAN_INTERVAL_MS = 5000;
const CARD_WIDTH = 30;

export function Dashboard({projectFilter, showAll}: DashboardProps) {
  const {exit} = useApp();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [tick, setTick] = useState(0);

  useInput((input, key) => {
    if (input === 'q' || (input === 'c' && key.ctrl)) {
      exit();
    }
  });

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const tracked = new Map<string, AgentSession>();

    function scan() {
      const discovered = scanSessions({showAll, projectFilter});

      for (const d of discovered) {
        if (tracked.has(d.jsonlFile)) continue;

        const session = createSession(d);
        tracked.set(d.jsonlFile, session);

        const cleanup = startWatching(session, () => {
          setTick((t) => t + 1);
        });
        cleanups.push(cleanup);
      }

      setSessions(Array.from(tracked.values()));
    }

    scan();
    const interval = setInterval(scan, RESCAN_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      for (const cleanup of cleanups) cleanup();
    };
  }, [projectFilter, showAll]);

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">claude-squad</Text>
        <Text dimColor>No active Claude sessions found.</Text>
        <Text dimColor>Start a Claude Code session and it will appear here.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">claude-squad </Text>
        <Text dimColor>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} | q to
          quit
        </Text>
      </Box>

      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {sessions.map((session) => (
          <AgentCard
            key={session.jsonlFile}
            session={session}
            width={CARD_WIDTH}
          />
        ))}
      </Box>
    </Box>
  );
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Dashboard and AgentCard Ink components"
```

---

### Task 7: Wire Up App and Test End-to-End

**Files:**
- Modify: `src/app.tsx`
- Modify: `bin/cli.tsx`

**Step 1: Update src/app.tsx to use Dashboard**

```tsx
import React from 'react';
import {Dashboard} from './components/Dashboard.js';

interface AppProps {
  projectFilter?: string;
  showAll?: boolean;
}

export function App({projectFilter, showAll}: AppProps) {
  return <Dashboard projectFilter={projectFilter} showAll={showAll} />;
}
```

**Step 2: Build and run**

Run: `npm run build && node dist/cli.js`
Expected: Shows dashboard with active Claude sessions as ASCII characters. Sessions update in real-time when agents take actions.

**Step 3: Test with --project flag**

Run: `node dist/cli.js --project telvana-api`
Expected: Only shows sessions matching "telvana-api"

**Step 4: Test with --all flag**

Run: `node dist/cli.js --all`
Expected: Shows older sessions too (not just last 24h)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire up app, end-to-end dashboard working"
```

---

### Task 8: README and Package Polish

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Step 1: Create README.md**

```markdown
# claude-squad

A terminal dashboard that monitors your active Claude Code sessions in real-time with ASCII art characters.

```
> claude-squad

claude-squad  3 sessions | q to quit

╭─ telvana-api ─────── (staging) ─╮  ╭─ telvana-ui ──────── (develop) ─╮
│                                  │  │                                  │
│           (*_*)~                 │  │          (-_-)zzZ                │
│                                  │  │                                  │
│  Editing service.ts              │  │  Waiting for input               │
╰──────────────────────────────────╯  ╰──────────────────────────────────╯
```

## Install

```bash
npm install -g claude-squad
```

Or run directly:

```bash
npx claude-squad
```

## Usage

```bash
# Watch all active sessions (last 24h)
claude-squad

# Filter to a specific project
claude-squad --project telvana-api

# Include older sessions
claude-squad --all
```

## How It Works

claude-squad watches Claude Code's JSONL transcript files in `~/.claude/projects/` to detect agent activity. It requires no configuration or hooks - just run it alongside your Claude Code sessions.

### Agent States

| Character | State | Meaning |
|-----------|-------|---------|
| `(-_-)zzZ` | Idle | Waiting for input |
| `(^_^)` | Active | Working on response |
| `(o.o)...` | Thinking | Processing |
| `(o_o) ` | Reading | Reading files |
| `(*_*)~` | Editing | Editing/writing files |
| `(>_<)>` | Running | Executing commands |
| `(o_o)?` | Searching | Searching codebase |
| `(o_o)!` | Permission | Needs your approval |

## Requirements

- Node.js >= 18
- Claude Code (generates the JSONL transcripts this tool reads)

## License

MIT
```

**Step 2: Create LICENSE**

MIT License with current year and author.

**Step 3: Final build check**

Run: `npm run build`
Expected: Clean build, no errors

**Step 4: Commit**

```bash
git add -A
git commit -m "docs: add README and LICENSE"
```

---

### Task 9: Verify and Tag

**Step 1: Clean install test**

Run: `rm -rf node_modules dist && npm install && npm run build && node dist/cli.js`
Expected: Builds and runs cleanly from scratch

**Step 2: Test npx-style execution**

Run: `npm link && claude-squad`
Expected: Dashboard launches. Then `npm unlink -g claude-squad` to clean up.

**Step 3: Tag initial release**

```bash
git tag v0.1.0
git commit --allow-empty -m "chore: tag v0.1.0"
```
