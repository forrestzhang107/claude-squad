# claude-squad

A terminal dashboard that monitors your active Claude Code sessions in real-time with ASCII art characters.

```
> claude-squad

claude-squad  3 sessions | q to quit

╭─ telvana-api ──────── (staging) ─╮  ╭─ telvana-ui ──────── (develop) ─╮
│                                   │  │                                  │
│            (*_*)~                 │  │           (-_-)zzZ               │
│                                   │  │                                  │
│  Editing service.ts               │  │  Waiting for input               │
╰───────────────────────────────────╯  ╰──────────────────────────────────╯
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

claude-squad watches Claude Code's JSONL transcript files in `~/.claude/projects/` to detect agent activity. It requires no configuration or hooks -- just run it alongside your Claude Code sessions.

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
