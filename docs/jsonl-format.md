# Claude Code JSONL Transcript Format

Claude Code writes session transcripts to `~/.claude/projects/<encoded-dir>/<session-id>.jsonl`.

## Directory Encoding

Filesystem paths are encoded by replacing non-alphanumeric characters (except `-`) with `-`:

```
/Users/forrest/Repos/telvana/telvana-api
  -> -Users-forrest-Repos-telvana-telvana-api
```

This creates ambiguity with hyphenated directory names (e.g. `telvana-api` vs `telvana/api`). We resolve this by walking the actual filesystem to find real directory boundaries. See `extractProjectName()` in `scanner.ts`.

## Record Types

Each line is a JSON object. Key fields:

### Assistant Messages

```json
{
  "type": "assistant",
  "message": {
    "content": [
      {"type": "tool_use", "id": "toolu_xxx", "name": "Read", "input": {"file_path": "/path/to/file"}},
      {"type": "thinking", "thinking": "..."},
      {"type": "text", "text": "Here's what I found..."}
    ]
  },
  "timestamp": "2025-01-01T00:00:00Z"
}
```

### User Messages

```json
{
  "type": "user",
  "message": {
    "content": [
      {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "..."}
    ]
  }
}
```

Or a new user prompt:

```json
{
  "type": "user",
  "message": {
    "content": "fix the bug in parser.ts"
  }
}
```

### System Events

Turn completion (either subtype signals end of turn):

```json
{"type": "system", "subtype": "turn_duration"}
{"type": "system", "subtype": "stop_hook_summary"}
```

### Progress Events

```json
{
  "type": "progress",
  "data": {
    "type": "bash_progress"
  }
}
```

Also: `mcp_progress`, `tool_permission_request` (rare/unreliable).

### Agent Progress (subagent tool tracking)

```json
{
  "type": "progress",
  "data": {
    "type": "agent_progress",
    "message": {
      "type": "assistant",
      "message": {
        "content": [{"type": "tool_use", "id": "toolu_xxx", "name": "Bash", ...}]
      }
    }
  }
}
```

Contains nested assistant/user messages from subagents. Used to track subagent tool_use/tool_result pairs for permission detection.

### SessionStart Hook (process matching)

```json
{
  "type": "progress",
  "data": {
    "type": "hook_progress",
    "hookEvent": "SessionStart"
  },
  "timestamp": "2025-01-01T00:00:00Z"
}
```

Written when a Claude Code session starts (including `--resume`). A single JSONL file can have multiple `SessionStart` hooks if the session was resumed multiple times. The scanner correlates these timestamps with `ps -o lstart=` process start times to match JSONL files to running processes.

### Context Compaction

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167706
  },
  "timestamp": "2025-01-01T00:00:00Z"
}
```

Written when Claude Code compacts its context window. Preceded by a `last-prompt` record. The session continues after compaction — the agent is not waiting for input.

### Last Prompt (clean exit)

```json
{"type": "last-prompt"}
```

Written when Claude Code exits cleanly. Triggers transition to "Session ended" waiting state.

## Tool Names

Common tools found in transcripts: `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Agent`, `Task`, `ToolSearch`, `ExitPlanMode`, `AskUserQuestion`, `Skill`, `NotebookEdit`.

## Other Fields

- `record.timestamp` -- ISO 8601, present on most records. Used to detect session start time.
- `record.gitBranch` -- Present on some records, gives the current git branch.
- `record.message.usage` -- Token usage on assistant messages. Contains `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. Total context = sum of all three (input_tokens alone is just the non-cached portion).

## Session Lifecycle

A JSONL file represents a single session ID but can span multiple process lifetimes via `--resume`. The file grows monotonically — records are only appended, never modified. Context compaction (when the model's context window fills) does not create a new file; the model continues writing to the same JSONL file with a fresh context.
