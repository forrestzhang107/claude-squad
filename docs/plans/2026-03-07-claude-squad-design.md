# claude-squad Design

## Overview

A standalone CLI tool that auto-discovers all active Claude Code sessions and displays them as ASCII art characters in the terminal with real-time status updates. Distributed as an npm package (`npx claude-squad`).

## Architecture

```
claude-squad (npm package)
├── bin/cli.ts          — entry point, parses args
├── src/
│   ├── app.tsx         — root Ink component
│   ├── scanner.ts      — discovers active sessions from ~/.claude/projects/
│   ├── watcher.ts      — watches JSONL files, emits state changes
│   ├── parser.ts       — parses JSONL lines into agent states
│   ├── components/
│   │   ├── Dashboard.tsx   — grid layout of agent cards
│   │   ├── AgentCard.tsx   — single agent: character + status + project info
│   │   └── Character.tsx   — ASCII art character with state-based expressions
│   └── characters.ts   — ASCII art for each state
```

## Tech Stack

- **Ink** (React for terminal) — declarative TUI rendering
- **TypeScript** — compiled to ESM
- **Node.js fs.watch / fs.watchFile** — JSONL file monitoring

## How It Works

### Session Discovery

- Scan `~/.claude/projects/*/` for `.jsonl` files
- Filter to recently-modified files (last 24h by default)
- Extract project name from directory name (e.g., `-Users-forrest-Repos-telvana-telvana-api` -> `telvana-api`)
- Poll for new `.jsonl` files appearing (new sessions)

### JSONL Parsing (ported from pixel-agents)

- Track file offset per session, read only new bytes
- `type: "assistant"` with `tool_use` blocks -> active state (reading, editing, running bash, etc.)
- `type: "user"` with `tool_result` blocks -> tool completed
- `type: "user"` with text content -> new user prompt (reset state)
- `type: "system"` + `subtype: "turn_duration"` -> idle/waiting
- `type: "progress"` -> subagent/bash progress tracking

### Agent States & Characters

```
Active/Editing:  (*.*)~    "Editing service.ts"
Active/Running:  (*_*)>    "Running: npm test"
Reading:         (o.o)     "Reading config.ts"
Searching:       (o_o)?    "Searching code"
Idle/Waiting:    (-_-)zzZ  "Waiting for input"
Permission:      (o_o)!    "Needs permission"
```

## Package Distribution

- `bin` field: `"claude-squad": "./dist/cli.js"`
- Install: `npm i -g claude-squad`
- One-shot: `npx claude-squad`

## CLI Flags

- `--project <name>` — filter to a specific project
- `--all` — show all sessions including stale (default: last 24h only)
