# Architecture

## Data Flow

```
~/.claude/projects/<encoded-dir>/<session>.jsonl
        |
    scanner.ts  -- discovers files, matches to running claude processes
        |
    watcher.ts  -- polls files for new bytes, manages timeouts
        |
    parser.ts   -- parses JSONL lines into AgentSession state
        |
    Dashboard.tsx / AgentCard.tsx  -- renders via Ink
```

## File Responsibilities

| File | Purpose |
|------|---------|
| `bin/cli.tsx` | CLI entry point, arg parsing, renders App |
| `src/app.tsx` | Thin wrapper, renders Dashboard |
| `src/scanner.ts` | Session discovery and process matching |
| `src/watcher.ts` | File polling, session lifecycle, timeout heuristics |
| `src/parser.ts` | JSONL line parsing, state extraction |
| `src/characters.ts` | Kaomoji art and color mappings |
| `src/types.ts` | TypeScript interfaces |
| `src/components/Dashboard.tsx` | Root component, scan loop, watcher lifecycle |
| `src/components/AgentCard.tsx` | Individual agent card rendering |

## Session Discovery (`scanner.ts`)

1. Read dirs from `~/.claude/projects/`
2. Resolve encoded dir names back to filesystem paths (e.g. `-Users-forrest-Repos-telvana-telvana-api` -> `/Users/forrest/Repos/telvana/telvana-api`)
3. Find `.jsonl` files in each dir
4. Use `ps` + `lsof` to find running claude processes and their working directories
5. Match sessions to processes, allowing N sessions per dir where N = process count
6. Fallback: if no process info, show most recent session per project

## JSONL Record Types

The parser handles these record types from Claude Code transcripts:

| Record | Key Fields | What We Extract |
|--------|-----------|-----------------|
| `type: "assistant"`, content has `tool_use` | `name`, `input`, `id` | Activity, status text, current file, tool history, working directory |
| `type: "assistant"`, content has `thinking` | -- | Thinking state |
| `type: "assistant"`, content has `text` only | -- | Responding state (if no tools in turn) |
| `type: "user"`, content has `tool_result` | `tool_use_id` | Tool completion, subagent tracking |
| `type: "user"`, content is text/text blocks | text content | Task summary (if 20+ chars) |
| `type: "system"`, `subtype: "turn_duration"` | -- | Turn ended, reset to waiting |
| `type: "progress"`, `data.type: "bash_progress"` | -- | Reset permission timer |
| `type: "progress"`, `data.type: "mcp_progress"` | -- | Reset permission timer |

## Timeout Heuristics

- **Permission detection (7s)**: If a tool_use has been active 7+ seconds with no progress events or tool_result, assume waiting for user approval
- **Idle detection (10s)**: If JSONL file hasn't been modified for 10s and no active tools, transition to "Waiting for input"
- **Stale detection (5min)**: If JSONL file hasn't been modified for 5 minutes, transition to "Inactive"

## Working Directory Detection

1. Collect file paths from `Read`, `Edit`, `Write`, `Glob`, `Grep` tool inputs
2. Keep last 20 paths
3. Score directories by `frequency * depth` to find the deepest common working directory
4. Walk up to find `.git` root
5. Parse repo name from `.git/config` remote URL
6. Fall back to git root basename, then spawn project name
