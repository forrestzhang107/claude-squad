# claude-hq

**See what all your Claude Code agents are doing -- at a glance.**

If you run multiple Claude Code sessions across different projects, you know the pain: constantly switching terminals, forgetting which agent is stuck on a permission prompt, losing track of what each one is working on. claude-hq gives you a single terminal window that shows everything.

```
claude-hq 4 sessions | q to quit

╭──────────────────────────────────────╮ ╭──────────────────────────────────────╮ ╭──────────────────────────────────────╮
│ telvana-api (staging)                │ │ claude-hq (main)                  │ │ telvana-ui (develop)                 │
│ fix the campaign tag aggregation     │ │ add permission timeout detection     │ │                                      │
│                                      │ │                                      │ │               (-_-)zzZ               │
│              (*_*)~                  │ │              (^_^)/                  │ │                                      │
│                                      │ │                                      │ │ Inactive                             │
│ Editing service.ts                   │ │ $ npm run build 2>&1                 │ │ Session: 44m                         │
│ File: service.ts                     │ │ File: watcher.ts                     │ │                                      │
│ Subagents: 1                         │ │ Session: 12m                         │ │ Recent:                              │
│ Session: 5m                          │ │                                      │ │    Reading settings.json             │
│                                      │ │ Recent:                              │ │  > Editing settings.json             │
│ Recent:                              │ │    Reading parser.ts                 │ ╰──────────────────────────────────────╯
│    Reading service.ts                │ │    Editing parser.ts                 │
│    Searching codebase                │ │    Editing watcher.ts                │
│  > Editing service.ts                │ │  > $ npm run build 2>&1              │
╰──────────────────────────────────────╯ ╰──────────────────────────────────────╯
```

Zero config. No hooks. No API keys. Just run it.

## Install

```bash
npm install -g --install-links github:forrestzhang107/claude-hq
```

## Usage

```bash
claude-hq
```

That's it. It auto-discovers every running Claude Code session and starts showing live status. Press `q` to quit.

```bash
# Filter to a specific project
claude-hq --project telvana

# Include older/inactive sessions
claude-hq --all
```

## What You Get

Each agent card shows:

- **Which repo** it's working in (auto-detected from file paths, not just where it was spawned)
- **What it's doing** -- reading, editing, running commands, thinking, searching
- **What you asked it to do** -- extracts the task from your last prompt
- **Git branch**
- **Current file** being touched
- **Subagent count** -- how many parallel agents it has running
- **Session duration**
- **Recent history** -- the last 4 tool calls
- **Permission alerts** -- instantly see when an agent is blocked waiting for your approval (red border, `(o_o)!`)

## Agent Characters

| | State | Meaning |
|---|-------|---------|
| `(^_^)` | Waiting | Done, waiting for your input |
| `(^_^)♪` | Working | Actively responding |
| `(o.o)...` | Thinking | Deep in thought |
| `(o_o) ` | Reading | Reading files |
| `(*_*)~` | Editing | Writing code |
| `(^_^)/` | Running | Executing commands |
| `(o_o)?` | Searching | Searching codebase or web |
| `(o_o)!` | Blocked | Needs your permission |
| `(-_-)zzZ` | Sleeping | Inactive for 5+ minutes |

## How It Works

claude-hq reads Claude Code's JSONL transcript files in `~/.claude/projects/`. It doesn't hook into Claude Code, inject anything, or use any API -- it's purely observational.

- **Process matching** -- uses `ps` and `lsof` to find running Claude processes and match them to sessions
- **Live tailing** -- polls transcript files every second for new activity
- **Permission detection** -- if a tool hasn't produced output in 7 seconds, it flags it as likely waiting for approval
- **Repo detection** -- figures out which repo each agent is actually working in by analyzing file paths from tool calls

## Requirements

- Node.js >= 18
- macOS (uses `ps` and `lsof` for process detection)
- Claude Code

## License

MIT
