# Agent States

## Activity Types

| Activity | Face | Color | Label | Triggered By |
|----------|------|-------|-------|-------------|
| `waiting` | `(·‿·)` / `(._.)` | white | Waiting | `✻` completion summary after last `⏺`, or content unchanged for 2+ polls. After 10 min, art switches to `(._.)` (visual only). |
| `inactive` | `(-_-)zzZ` | gray | Inactive | Waiting for 60+ minutes continuously |
| `active` | `(^_^)♪` | cyan | Working | Last `⏺` line is text (responding) or fallback |
| `thinking` | `(o.o)...` | cyan | Thinking | Active spinner (`✢✳✽`) on screen, or last `⏺` line matches `Thinking...` |
| `reading` | `(o_o) ` | cyan | Reading | `⏺ Read(path)` or `⏺ Read N files` on screen |
| `editing` | `(*_*)~` | yellow | Editing | `⏺ Edit(path)`, `⏺ Update(path)`, or `⏺ Write(path)` on screen |
| `running` | `(·_·)>_` | green | Running | `⏺ Bash(cmd)`, `⏺ Agent(...)`, or `⏺ Task(...)` on screen |
| `searching` | `(o_o)?` | magenta | Searching | `⏺ Glob(...)`, `⏺ Grep(...)`, `⏺ Explore(...)`, `⏺ WebFetch(...)`, `⏺ WebSearch(...)`, or `⏺ Searched for N patterns` on screen |
| `permission` | `(>_<)!` | red | Blocked | `Allow ToolName(args)?` visible on terminal screen |

## State Detection

States are detected by reading terminal history via AppleScript (`history of tab`, last 3000 chars). Detection is priority-ordered:

1. **Permission** — `Allow ToolName(args)?` pattern in last 2000 chars
2. **Active spinner** — `✢✳✽` (Dingbat asterisks) followed by text (e.g. `✳ Hatching…`)
3. **Completion** — `✻ <verb> for <duration>` after last `⏺` line → waiting
4. **Thinking** — Last `⏺` line matches `Thinking...`
5. **Tool active** — Last `⏺` line matches `ToolName(args)` pattern
6. **Collapsed summary** — Last `⏺` line matches `Searched for N patterns` or `Read N files`
7. **Responding** — Last `⏺` line is plain text
8. **Content stale fallback** — If "responding" but terminal content unchanged for 2+ polls → waiting
9. **No content** — No `⏺` found → waiting

## Permission Detection

Direct observation: if the terminal screen shows `Allow <ToolName>(<args>)?`, the session is in permission state. When the user approves or denies, the prompt disappears and the state clears on the next poll (2 seconds).

## Waiting Detection

Two mechanisms detect waiting state:

1. **`✻` completion summary** (primary, instant): Claude Code emits `✻ <verb> for <duration>` (e.g. `✻ Brewed for 2m 1s`) when a response cycle finishes. If this appears after the last `⏺` line, the session is waiting.
2. **Content change detection** (fallback, ~4s delay): If detected as "responding" but terminal content hasn't changed for 2 consecutive polls, the session transitions to waiting. This catches short responses where `✻` doesn't appear.

Note: Claude Code's `❯` prompt is always visible at the bottom of the terminal (wrapped in `────` separator lines) even while actively working, so it cannot be used to detect waiting state.

## Inactivity Detection

If `lastActivityAt` shows the session has been in `waiting` state for 60+ minutes, it transitions to `inactive`.

The `waiting` state's visual art switches from `(·‿·)` to `(._.)` after 10 minutes (`BORED_ART_MS` in `characters.ts`), but this is purely cosmetic — it is not a separate state.
