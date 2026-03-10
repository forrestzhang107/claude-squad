# Architecture

## Data Flow

```
ps / lsof  --  discover running claude processes with TTYs and CWDs
     |
 poller.ts  --  batch-read terminal history via AppleScript
     |           parse activity state from screen content
     |
 Dashboard.tsx / AgentCard.tsx  --  renders via Ink
```

## File Responsibilities

| File | Purpose |
|------|---------|
| `bin/cli.tsx` | CLI entry point, renders App |
| `src/app.tsx` | Thin wrapper, renders Dashboard |
| `src/poller.ts` | Process discovery, TTY reading, state detection, main poll loop |
| `src/characters.ts` | Kaomoji art and color mappings |
| `src/types.ts` | TypeScript interfaces (AgentActivity, AgentSession) |
| `src/terminal.ts` | Switch Terminal.app to a tab by TTY |
| `src/components/Dashboard.tsx` | Root component, single 2s poll loop |
| `src/components/AgentCard.tsx` | Individual agent card rendering |

## Session Discovery (`poller.ts`)

1. `ps -eo pid,lstart,tty,comm | grep -w 'claude$'` — find running claude processes
2. `lsof -a -d cwd -Fn -p <pids>` — get CWD for each process
3. Only processes with a valid TTY (`/dev/ttysNNN`) and CWD are tracked
4. Session identity = PID. No JSONL files, no session matching.

## State Detection

Terminal.app history is read via AppleScript (`history of tab`, last 3000 chars). State is determined by marker patterns, checked in priority order:

| Priority | State | Pattern |
|----------|-------|---------|
| 1 | `permission` | `Allow \w[\w:.-]*\(.*?\)\?` in last 2000 chars |
| 2 | `thinking` | Active spinner `✢✳✽` (Dingbat asterisks) after last `⏺` |
| 3 | `waiting` | `✻` completion summary (e.g. `✻ Brewed for 2m`) after last `⏺` |
| 4 | `thinking` | Last `⏺` line matches `Thinking...` |
| 5 | tool-specific | Last `⏺` line matches `ToolName(args)` — includes `Update`, `Explore` |
| 6 | tool-specific | Collapsed summary: `⏺ Searched for N patterns` or `⏺ Read N files` |
| 7 | `active`/`waiting` | Last `⏺` line is plain text — `active` if still generating, `waiting` if `❯` prompt follows |
| 8 | `waiting` | Content unchanged for 2+ polls (stale fallback) |
| 9 | `waiting` | No `⏺` content found (fresh session) |

Note: The `❯` prompt is always visible at the bottom of Claude Code's terminal. It is only used for waiting detection when it appears *after* a `⏺` text response line with no active content in between.

## Polling

Single 2-second interval in Dashboard:

1. Discover processes (`ps` + `lsof`)
2. Batch-read terminal history for all TTYs (one AppleScript call)
3. Parse each TTY's content into activity + status + conversation context (last prompt, last response)
4. Content fingerprinting: if "responding" but content unchanged for 2+ polls → waiting
5. Diff against previous state to update `lastActivityAt`
6. Git branch refreshed every ~60s (not every poll)

## Git Branch

Fetched via `git branch --show-current` using the process CWD. Cached between polls and refreshed every ~60 seconds.
