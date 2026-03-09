# Agent States

## Activity Types

| Activity | Face | Color | Label | Triggered By |
|----------|------|-------|-------|-------------|
| `waiting` | `(·‿·)` / `(._.)` | white | Waiting | Turn end signal (`turn_duration`, `stop_hook_summary`), interrupt, or `last-prompt`. After 10 min, art switches to `(._.)` (visual only). |
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
    tool_result    next record   turn_duration / stop_hook_summary
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
| `turn_duration` | System record in JSONL | Immediate |
| `stop_hook_summary` | System record in JSONL | Immediate |
| `[Request interrupted by user]` | User record from Ctrl+C | Immediate |
| `last-prompt` | Final JSONL record on clean exit | Immediate (but see compaction below) |
| New user prompt | User record (non-tool-result) | Immediate (→ `active`) |

There is **no** idle-based timeout for the waiting transition. Earlier versions used a 10-second idle timeout on "Responding..." state, but this caused false "Waiting for input" flashes when the model paused between tool calls mid-turn. The definitive JSONL signals above are the only way to enter waiting state.

**`respondedAt` tracking:** The `active` state is used for both "Starting..." and "Responding...". `respondedAt` tracks when a text-only assistant message was seen:

- `respondedAt = 0`: "Starting..." or "Working..." — model is generating or between tool calls
- `respondedAt > 0`: "Responding..." — model sent text, may or may not be end of turn
- Cleared when `tool_use` arrives (text was mid-stream, not end of turn)

## Context Compaction

When Claude Code compacts context (auto-triggered near context limit), this sequence is written:

1. `last-prompt` → would set "Session ended" (incorrect during compaction)
2. `compact_boundary` → overrides to `active` ("Compacting context...")
3. New `user` record → normal "Starting..." flow resumes

The `compact_boundary` record (type `system`, subtype `compact_boundary`) signals that the session is continuing, not ending. It contains `compactMetadata.trigger` ("auto") and `compactMetadata.preTokens` (token count before compaction).

## Tool Result Handling

When all `tool_result` records arrive and `activeToolIds` empties:
- State transitions to `active` ("Working...") with `respondedAt=0`
- `hadToolsInTurn` is cleared
- This signals that the model is generating its next response

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
