# Claude Code JSONL Transcript Format

Claude Code writes session transcripts to `~/.claude/projects/<encoded-dir>/<session-id>.jsonl`.

## Directory Encoding

Filesystem paths are encoded by replacing non-alphanumeric characters (except `-`) with `-`:

```
/Users/forrest/Repos/telvana/telvana-api
  -> -Users-forrest-Repos-telvana-telvana-api
```

This creates ambiguity with hyphenated directory names (e.g. `telvana-api` vs `telvana/api`). We resolve this by walking the actual filesystem to find real directory boundaries. See `extractProjectName()` and `dirNameToPath()` in `scanner.ts`.

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

Turn completion:

```json
{
  "type": "system",
  "subtype": "turn_duration"
}
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

## Tool Names

Common tools found in transcripts: `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Agent`, `Task`, `ToolSearch`, `ExitPlanMode`, `AskUserQuestion`.

## Other Fields

- `record.timestamp` -- ISO 8601, present on most records. Used to detect session start time.
- `record.gitBranch` -- Present on some records, gives the current git branch.
