# CLAUDE.md

## Project Overview

claude-squad is a terminal dashboard (TUI) that monitors Claude Code agent sessions in real-time by watching JSONL transcript files. Built with Ink (React for the terminal).

## Commands

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm run start    # Run the dashboard
```

## Git Policy

Do NOT commit, push, or perform any git actions unless explicitly asked. This includes staging files, creating commits, and pushing to remote.

## Key Conventions

- ESM (`"type": "module"`)
- Function-based exports, no classes
- Ink components use React 18
- All file I/O is synchronous (polling-based, not perf-critical)
- macOS only (uses `ps` and `lsof` for process detection)

## Reference Docs

- [`docs/architecture.md`](docs/architecture.md) -- Data flow, file responsibilities, session discovery, timeout heuristics
- [`docs/agent-states.md`](docs/agent-states.md) -- Activity types, faces, colors, state transitions
- [`docs/jsonl-format.md`](docs/jsonl-format.md) -- Claude Code JSONL transcript format, record types, directory encoding
