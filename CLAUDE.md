# CLAUDE.md

## Project Overview

claude-squad is a terminal dashboard (TUI) that monitors Claude Code agent sessions in real-time by reading visible terminal content from Terminal.app. Built with Ink (React for the terminal).

## Commands

```bash
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm run start    # Run the dashboard
npm test         # Run all tests (vitest)
```

## Git Policy

Do NOT commit, push, or perform any git actions unless explicitly asked. This includes staging files, creating commits, and pushing to remote.

## Workflow

Always run `npm run build` after making changes so they can be tested locally.

## Key Conventions

- ESM (`"type": "module"`)
- Function-based exports, no classes
- Ink components use React 18
- All file I/O is synchronous (polling-based, not perf-critical)
- macOS only (uses `ps` and `lsof` for process detection)

## Testing

- Framework: **Vitest** (ESM-native, run with `npm test`)
- Tests live in `tests/` mirroring `src/` structure (e.g. `tests/poller.test.ts` tests `src/poller.ts`)
- Test helpers are in `tests/helpers.ts` — use `makeSession()` to create test sessions
- Test pure logic directly; avoid testing Ink component rendering
- When adding or changing state detection logic (poller), add corresponding test cases
- When fixing a bug, add a regression test that reproduces the bug before fixing it

## Reference Docs

- [`docs/architecture.md`](docs/architecture.md) -- Data flow, file responsibilities, session discovery, polling
- [`docs/agent-states.md`](docs/agent-states.md) -- Activity types, faces, colors, state detection patterns
