# claude-squad

A terminal dashboard that monitors your active Claude Code sessions in real-time with kaomoji characters.

```
claude-squad 4 sessions | q to quit

╭──────────────────────────────────────╮ ╭──────────────────────────────────────╮
│ telvana-api (staging)                │ │ telvana-ui (develop)                 │
│ fix the campaign tag aggregation     │ │                                      │
│                                      │ │               (-_-)zzZ               │
│              (*_*)~                  │ │                                      │
│                                      │ │ Inactive                             │
│ Editing service.ts                   │ │ Session: 44m                         │
│ File: service.ts                     │ │                                      │
│ Subagents: 1                         │ │ Recent:                              │
│ Session: 5m                          │ │    Reading settings.json             │
│                                      │ │  > Editing settings.json             │
│ Recent:                              │ ╰──────────────────────────────────────╯
│    Reading service.ts                │
│    Searching codebase                │
│  > Editing service.ts                │
╰──────────────────────────────────────╯
```

## Install

```bash
npm install -g github:forrestzhang107/claude-squad
```

## Usage

```bash
# Watch all active sessions
claude-squad

# Filter to a specific project
claude-squad --project telvana

# Include older sessions
claude-squad --all
```

## What It Shows

Each card displays:

- **Project name** -- detected from the git repo the agent is working in
- **Git branch**
- **Task summary** -- the last substantial user prompt
- **Current activity** -- with a kaomoji character
- **Current file** being read/edited
- **Active subagents**
- **Session duration**
- **Recent tool history** -- last 4 actions

## Agent States

| Character | State | Color | Meaning |
|-----------|-------|-------|---------|
| `(^_^)` | Waiting | white | Turn ended, waiting for your input |
| `(-_-)zzZ` | Stale | gray | No activity for 5+ minutes |
| `(^_^)♪` | Active | cyan | Responding to your prompt |
| `(o.o)...` | Thinking | cyan | Extended thinking |
| `(o_o) ` | Reading | blue | Reading files |
| `(*_*)~` | Editing | yellow | Editing/writing files |
| `(^_^)/` | Running | green | Executing commands |
| `(o_o)?` | Searching | magenta | Searching codebase/web |
| `(o_o)!` | Permission | red | Needs your approval |

## How It Works

claude-squad watches Claude Code's JSONL transcript files in `~/.claude/projects/` to detect agent activity. It requires no configuration or hooks -- just run it alongside your Claude Code sessions.

It uses `ps` and `lsof` to match JSONL files to running Claude processes, so it only shows sessions that are actually active (or recently active within 24h with `--all`).

Permission detection uses a 7-second timeout heuristic -- if a tool has been running for 7+ seconds with no progress events, it's likely waiting for your approval.

## Requirements

- Node.js >= 18
- macOS (uses `ps` and `lsof` for process detection)
- Claude Code (generates the JSONL transcripts this tool reads)

## License

MIT
