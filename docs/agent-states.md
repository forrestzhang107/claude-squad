# Agent States

## Activity Types

| Activity | Face | Color | Label | Triggered By |
|----------|------|-------|-------|-------------|
| `waiting` | `(^_^)` | white | Waiting | `turn_duration` event, or 10s idle timeout |
| `stale` | `(-_-)zzZ` | gray | Sleeping | JSONL file unmodified for 5+ minutes |
| `active` | `(^_^)♪` | cyan | Working | Assistant text response (no tools in turn), or new user prompt |
| `thinking` | `(o.o)...` | cyan | Thinking | Assistant `thinking` block |
| `reading` | `(o_o) ` | blueBright | Reading | `Read` tool use |
| `editing` | `(*_*)~` | yellow | Editing | `Edit` or `Write` tool use |
| `running` | `(^_^)/` | green | Running | `Bash`, `Agent`, or `Task` tool use |
| `searching` | `(o_o)?` | magenta | Searching | `Glob`, `Grep`, `WebFetch`, `WebSearch` tool use |
| `permission` | `(o_o)!` | red | Blocked | 7s timeout with no progress events |

## State Transitions

```
New user prompt  -->  active ("Starting...")
                        |
                        v
               assistant message
              /         |         \
         tool_use    thinking    text only
            |           |        (no tools in turn)
            v           v           |
     [specific      thinking        v
      activity]    ("Thinking...")  active
         |              |        ("Responding...")
         v              v           |
    tool_result    next message     |
         |                          |
         v                          v
    (next tool or...)          turn_duration
                                    |
                                    v
                              waiting ("Waiting for input")
                                    |
                              (5 min pass)
                                    |
                                    v
                              stale ("Inactive")
```

## Permission Detection

When a tool_use is active:
1. Timer starts at 7 seconds
2. `bash_progress` / `mcp_progress` events reset the timer
3. If timer expires -> `permission` state
4. `tool_result` or progress event clears permission state
