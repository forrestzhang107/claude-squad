import type {AgentSession, DiscoveredSession} from '../src/types.js';
import {createSession} from '../src/watcher.js';

/** Create a minimal DiscoveredSession for testing. */
export function makeDiscovered(overrides: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    sessionId: 'test-session-1',
    projectDir: '/tmp/test-project',
    projectName: 'test-project',
    jsonlFile: '/tmp/test.jsonl',
    modifiedAt: Date.now(),
    createdAt: Date.now(),
    pid: 0,
    processStartedAt: 0,
    ...overrides,
  };
}

/** Create a fresh AgentSession for testing. */
export function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const session = createSession(makeDiscovered());
  return Object.assign(session, overrides);
}

// --- JSONL record builders ---

export function assistantToolUse(toolName: string, input: Record<string, unknown> = {}, id?: string) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {type: 'tool_use', id: id || `tool_${toolName}_${Date.now()}`, name: toolName, input},
      ],
    },
  });
}

export function assistantText(text: string) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{type: 'text', text}],
    },
  });
}

export function assistantThinking(thinking = 'thinking...') {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{type: 'thinking', thinking}],
    },
  });
}

export function assistantTextAndTool(text: string, toolName: string, input: Record<string, unknown> = {}, toolId?: string) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {type: 'text', text},
        {type: 'tool_use', id: toolId || `tool_${toolName}_${Date.now()}`, name: toolName, input},
      ],
    },
  });
}

export function assistantWithUsage(text: string, usage: Record<string, number>) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{type: 'text', text}],
      usage,
    },
  });
}

export function userToolResult(toolUseId: string) {
  return JSON.stringify({
    type: 'user',
    message: {
      content: [{type: 'tool_result', tool_use_id: toolUseId}],
    },
  });
}

export function userPrompt(text: string) {
  return JSON.stringify({
    type: 'user',
    message: {
      content: [{type: 'text', text}],
    },
  });
}

export function userPromptString(text: string) {
  return JSON.stringify({
    type: 'user',
    message: {content: text},
  });
}

export function systemTurnDuration() {
  return JSON.stringify({type: 'system', subtype: 'turn_duration'});
}

export function systemStopHookSummary() {
  return JSON.stringify({type: 'system', subtype: 'stop_hook_summary'});
}

export function lastPrompt() {
  return JSON.stringify({type: 'last-prompt'});
}

export function progressPermissionRequest() {
  return JSON.stringify({type: 'progress', data: {type: 'tool_permission_request'}});
}

export function progressBash() {
  return JSON.stringify({type: 'progress', data: {type: 'bash_progress'}});
}

export function progressMcp() {
  return JSON.stringify({type: 'progress', data: {type: 'mcp_progress'}});
}

export function progressAgentToolUse(toolId: string) {
  return JSON.stringify({
    type: 'progress',
    data: {
      type: 'agent_progress',
      message: {
        type: 'assistant',
        message: {
          content: [{type: 'tool_use', id: toolId, name: 'Bash', input: {command: 'ls'}}],
        },
      },
    },
  });
}

export function progressAgentToolResult(toolId: string) {
  return JSON.stringify({
    type: 'progress',
    data: {
      type: 'agent_progress',
      message: {
        type: 'user',
        message: {
          content: [{type: 'tool_result', tool_use_id: toolId}],
        },
      },
    },
  });
}

export function recordWithTimestamp(timestamp: string) {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      content: [{type: 'text', text: 'hello'}],
    },
  });
}

export function recordWithBranch(branch: string) {
  return JSON.stringify({
    type: 'assistant',
    gitBranch: branch,
    message: {
      content: [{type: 'text', text: 'hello'}],
    },
  });
}
