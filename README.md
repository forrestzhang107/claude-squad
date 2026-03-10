# claude-squad

**See what all your Claude Code agents are doing -- at a glance.**

If you run multiple Claude Code sessions across different projects, you know the pain: constantly switching terminals, forgetting which agent is stuck on a permission prompt, losing track of what each one is working on. claude-squad gives you a single terminal window that shows everything.

```
claude-squad 3 sessions | q to quit

╭──────────────────────────────────────╮ ╭──────────────────────────────────────╮ ╭──────────────────────────────────────╮
│ telvana-api (staging)                │ │ claude-squad (main)                  │ │ telvana-ui (develop)                 │
│                                      │ │                                      │ │                                      │
│              (*_*)~                  │ │              (^_^)/                  │ │               (-_-)zzZ               │
│                                      │ │                                      │ │                                      │
│ Editing service.ts                   │ │ $ npm run build 2>&1                 │ │ Inactive                             │
│ Session: 5m                          │ │ Session: 12m                         │ │ Session: 44m                         │
╰──────────────────────────────────────╯ ╰──────────────────────────────────────╯ ╰──────────────────────────────────────╯
```

Zero config. No hooks. No API keys. Just run it.

## Install

```bash
npm install -g @forrestzhang107/claude-squad
```

## Usage

```bash
claude-squad
```

That's it. It auto-discovers every running Claude Code session and starts showing live status. Press `q` to quit.

## What You Get

Each agent card shows:

- **Which repo** it's working in (detected from the process working directory)
- **What it's doing** -- reading, editing, running commands, thinking, searching
- **Git branch**
- **Session duration**
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
| `(-_-)zzZ` | Sleeping | Inactive for 60+ minutes |

## How It Works

claude-squad reads Terminal.app history for each running Claude Code session. It doesn't hook into Claude Code, inject anything, or use any API -- it's purely observational.

- **Process discovery** -- uses `ps` and `lsof` to find running Claude processes, their TTYs, and working directories
- **Terminal reading** -- reads the last few thousand characters of terminal history via AppleScript and parses the visible state
- **State detection** -- recognizes Claude Code's terminal markers (`⏺` tool calls, `✻` completion summaries, spinner characters) to determine what each agent is doing
- **Permission detection** -- spots both `Allow Tool(args)?` and `Do you want to proceed?` permission prompts

## Requirements

- Node.js >= 18
- macOS (uses `ps`, `lsof`, and Terminal.app AppleScript)
- Claude Code

## License

MIT
