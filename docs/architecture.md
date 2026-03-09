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
4. Use `ps -eo pid,comm` to find running `claude` processes, then `ps -o lstart=` for start times
5. Match sessions to processes by correlating process start times with `SessionStart` hook timestamps in JSONL files (greedy closest-match algorithm)
6. Default: show only sessions matched to a running process. `--all`: show one session per project (prefer matched, then most recent)

### Process Matching Details

Directory-based matching (CWD via `lsof`) is **not used** — multiple sessions can share a CWD (e.g. worktrees), making it unreliable. Instead, matching is purely timestamp-based:

- Each JSONL file can contain multiple `SessionStart` hook events (from `--resume` operations)
- For each (session, process) pair, the closest `SessionStart` timestamp to the process start time is used
- All pairs are sorted by time delta and greedily assigned (closest match first, no reuse)
- `SessionStart` timestamps are cached by file path + size (incremental reads for growing files)
- Falls back to file birth time if no `SessionStart` hooks are found

### Stale Session Filtering

Sessions are matched to processes **before** applying the 24-hour stale filter. This ensures a long-running process always finds its session even if the file hasn't been modified recently. Unmatched sessions older than 24 hours are excluded.

## JSONL Record Types

The parser handles these record types from Claude Code transcripts:

| Record | Key Fields | What We Extract |
|--------|-----------|-----------------|
| `type: "assistant"`, content has `tool_use` | `name`, `input`, `id` | Activity, status text, current file, tool history, working directory |
| `type: "assistant"`, content has `thinking` | -- | Thinking state |
| `type: "assistant"`, content has `text` only | -- | Responding state (if no tools in turn) |
| `type: "user"`, content has `tool_result` | `tool_use_id` | Tool completion, subagent tracking |
| `type: "user"`, content is text/text blocks | text content | Task summary (if 20+ chars) |
| `type: "system"`, `subtype: "turn_duration"` or `"stop_hook_summary"` | -- | Turn ended, reset to waiting |
| `type: "progress"`, `data.type: "bash_progress"` | -- | Reset permission timer |
| `type: "progress"`, `data.type: "mcp_progress"` | -- | Reset permission timer |
| `type: "progress"`, `data.type: "agent_progress"` | nested `message` | Subagent tool_use/tool_result tracking |
| `type: "system"`, `subtype: "compact_boundary"` | `compactMetadata` | Context compaction (override `last-prompt` waiting state) |
| `type: "progress"`, `data.type: "tool_permission_request"` | -- | Explicit permission state |
| `type: "progress"`, `data.type: "hook_progress"`, `hookEvent: "SessionStart"` | `timestamp` | Process-to-session matching (in scanner) |
| `type: "last-prompt"` | -- | Session ended cleanly |

## Timeout Heuristics

- **Permission detection (7s)**: If a tool_use has been active 7+ seconds with no progress events or tool_result, assume waiting for user approval. Exempt tools: `Agent`, `Task`, `AskUserQuestion`, `Skill` (long-running by nature). Also applies to subagent tool calls tracked via `agent_progress`.
- **Inactive detection (60min)**: If JSONL file hasn't been modified for 60 minutes, transition to "Inactive"

Note: There is **no** idle-to-waiting timeout. The "Waiting for input" state is set exclusively by definitive JSONL signals (`turn_duration`, `stop_hook_summary`, user interrupt, `last-prompt`). This avoids false "Waiting" flashes when the model pauses between tool calls mid-turn.

## Working Directory Detection

1. Collect file paths from `Read`, `Edit`, `Write`, `Glob`, `Grep` tool inputs
2. Keep last 20 paths
3. Score directories by `frequency * depth` to find the deepest common working directory
4. Walk up to find `.git` root (follows `gitdir:` reference in worktrees)
5. Parse repo name from `.git/config` remote URL
6. Fall back to git root basename, then project name
