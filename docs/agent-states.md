# Agent States

## Activity Types

| Activity | Face | Color | Label | Triggered By |
|----------|------|-------|-------|-------------|
| `waiting` | `(·‿·)` / `(._.)` | white | Waiting | Turn end (see below), interrupt, or idle timeout. After 10 min, art switches to `(._.)` (visual only). |
| `inactive` | `(-_-)zzZ` | gray | Inactive | JSONL file unmodified for 60+ minutes |
| `active` | `(^_^)♪` | cyan | Working | New user prompt ("Starting...") or assistant text block ("Responding...") |
| `thinking` | `(o.o)...` | cyan | Thinking | Assistant `thinking` block (no tool_use in same message) |
| `reading` | `(o_o) ` | cyan | Reading | `Read` tool use |
| `editing` | `(*_*)~` | yellow | Editing | `Edit` or `Write` tool use |
| `running` | `(·_·)>_` | green | Running | `Bash`, `Agent`, or `Task` tool use |
| `searching` | `(o_o)?` | magenta | Searching | `Glob`, `Grep`, `WebFetch`, `WebSearch` tool use |
| `permission` | `(>_<)!` | red | Blocked | 7s timeout on pending tool with no progress events |

## JSONL Streaming

Claude Code streams assistant responses as **separate JSONL records**. A single
API response with thinking + text + tool_use may appear as three records:

```
record N:   { "type": "assistant", content: [{ "type": "thinking", ... }] }
record N+1: { "type": "assistant", content: [{ "type": "text", ... }] }
record N+2: { "type": "assistant", content: [{ "type": "tool_use", ... }] }
```

This means a text-only record does NOT necessarily mean the turn is over — a
tool_use record may follow milliseconds later. The `respondedAt` timestamp
tracks this (see Idle Timeout below).

## State Transitions

```
New user prompt  -->  active ("Starting...", respondedAt=0)
                        |
                        v
               assistant message
              /         |         \
         tool_use    thinking    text only
            |           |           |
            v           v           v
     [specific      thinking     active
      activity]   ("Thinking...")  ("Responding...", respondedAt=now)
         |              |           |
         v              v           v
    tool_result    next record   turn_duration / stop_hook_summary / idle timeout (10s)
         |                          |
         v                          v
    active ("Working...")     waiting ("Waiting for input")
    (all tools done)                |
                              (60 min pass)
                                    |
                                    v
                              inactive ("Inactive")
```

## Turn End Detection

A turn ends (→ `waiting`) via one of these signals:

| Signal | Source | Timing |
|--------|--------|--------|
| `turn_duration` | System record in JSONL | Immediate (when present) |
| `stop_hook_summary` | System record in JSONL | Immediate (when present) |
| Idle timeout on "Responding..." | `respondedAt` set + 10s no file changes | 10 seconds |
| `[Request interrupted by user]` | User record from Ctrl+C | Immediate |
| `last-prompt` | Final JSONL record on clean exit | Immediate |
| New user prompt | User record (non-tool-result) | Immediate (→ `active`) |

**Why `respondedAt` matters:** The `active` state is used for both "Starting..."
(user prompt sent, model thinking) and "Responding..." (text block received).
Only "Responding..." should idle-timeout, because "Starting..." means the model
is still generating and the JSONL won't update until the response is complete.

- `respondedAt = 0`: "Starting..." — no idle timeout
- `respondedAt > 0`: "Responding..." — idle timeout after 10s
- Cleared when `tool_use` arrives (text was mid-stream, not end of turn)

## Tool Result Handling

When all `tool_result` records arrive and `activeToolIds` empties:
- State transitions to `active` ("Working...") with `respondedAt=0`
- This prevents stale tool states (e.g. `reading`) from triggering idle timeout
  while the model generates its next response

## Permission Detection

### Direct tools

When a `tool_use` block is tracked in `activeToolIds`:
1. Timer starts at 7 seconds from the tool_use timestamp
2. `bash_progress` / `mcp_progress` events reset the timer
3. If timer expires → `permission` state
4. `tool_result` clears the tool from tracking
5. Exempt tools (Agent, Task, AskUserQuestion, Skill) skip the timeout —
   they are long-running by nature

### Subagent tools

Subagent (Agent/Task) tool calls are tracked separately via `agent_progress`
events, which contain the subagent's full messages:

1. `agent_progress` with assistant `tool_use` → add to `pendingSubagentToolIds`
2. `agent_progress` with user `tool_result` → remove from tracking
3. If a pending subagent tool has no result for 7s → `permission` state
4. `bash_progress` / `mcp_progress` reset subagent tool timestamps too
5. When the parent Agent/Task tool completes, all subagent tracking is cleared

## Inactivity Detection

If the JSONL file's mtime exceeds 60 minutes (`INACTIVE_TIMEOUT_MS`), the session
transitions to `inactive`. This handles cases where the agent is idle or the
process was killed without writing any termination record (e.g. SIGKILL).

Note: The `waiting` state's visual art switches from `(·‿·)` to `(._.)` after
10 minutes (`BORED_ART_MS` in `characters.ts`), but this is purely cosmetic —
it is not a separate state.
