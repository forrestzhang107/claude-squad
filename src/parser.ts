import * as path from 'node:path';
import type {AgentActivity, AgentSession} from './types.js';

const BASH_CMD_MAX = 40;

function formatToolStatus(
  toolName: string,
  input: Record<string, unknown>,
): {activity: AgentActivity; statusText: string} {
  const base = (p: unknown) =>
    typeof p === 'string' ? path.basename(p) : '';

  switch (toolName) {
    case 'Read':
      return {activity: 'reading', statusText: `Reading ${base(input.file_path)}`};
    case 'Edit':
      return {activity: 'editing', statusText: `Editing ${base(input.file_path)}`};
    case 'Write':
      return {activity: 'editing', statusText: `Writing ${base(input.file_path)}`};
    case 'Bash': {
      const cmd = (input.command as string) || '';
      const truncated =
        cmd.length > BASH_CMD_MAX ? cmd.slice(0, BASH_CMD_MAX) + '...' : cmd;
      return {activity: 'running', statusText: `$ ${truncated}`};
    }
    case 'Glob':
    case 'Grep':
      return {activity: 'searching', statusText: 'Searching codebase'};
    case 'WebFetch':
    case 'WebSearch':
      return {activity: 'searching', statusText: 'Searching the web'};
    case 'Agent':
    case 'Task':
      return {activity: 'running', statusText: 'Running subtask'};
    default:
      return {activity: 'active', statusText: `Using ${toolName}`};
  }
}

export function processLine(session: AgentSession, line: string): boolean {
  let changed = false;
  try {
    const record = JSON.parse(line);

    if (record.gitBranch && record.gitBranch !== session.gitBranch) {
      session.gitBranch = record.gitBranch;
      changed = true;
    }

    if (
      record.type === 'assistant' &&
      Array.isArray(record.message?.content)
    ) {
      const blocks = record.message.content as Array<{
        type: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;

      const toolUses = blocks.filter((b) => b.type === 'tool_use');

      if (toolUses.length > 0) {
        session.hadToolsInTurn = true;
        const lastTool = toolUses[toolUses.length - 1]!;
        const toolName = lastTool.name || '';
        const {activity, statusText} = formatToolStatus(
          toolName,
          lastTool.input || {},
        );
        session.activity = activity;
        session.statusText = statusText;
        session.lastActivityAt = Date.now();

        for (const tool of toolUses) {
          if (tool.id) {
            session.activeToolIds.add(tool.id);
            session.activeToolNames.set(tool.id, tool.name || '');
          }
        }
        changed = true;
      } else if (blocks.some((b) => b.type === 'thinking')) {
        session.activity = 'thinking';
        session.statusText = 'Thinking...';
        session.lastActivityAt = Date.now();
        changed = true;
      } else if (
        blocks.some((b) => b.type === 'text') &&
        !session.hadToolsInTurn
      ) {
        session.activity = 'active';
        session.statusText = 'Responding...';
        session.lastActivityAt = Date.now();
        changed = true;
      }
    } else if (record.type === 'user') {
      const content = record.message?.content;
      if (Array.isArray(content)) {
        const hasToolResult = content.some(
          (b: {type: string}) => b.type === 'tool_result',
        );
        if (hasToolResult) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              session.activeToolIds.delete(block.tool_use_id);
              session.activeToolNames.delete(block.tool_use_id);
            }
          }
          if (session.activeToolIds.size === 0) {
            session.hadToolsInTurn = false;
          }
          changed = true;
        } else {
          session.activity = 'active';
          session.statusText = 'Starting...';
          session.activeToolIds.clear();
          session.activeToolNames.clear();
          session.hadToolsInTurn = false;
          session.lastActivityAt = Date.now();
          changed = true;
        }
      } else if (typeof content === 'string' && content.trim()) {
        session.activity = 'active';
        session.statusText = 'Starting...';
        session.activeToolIds.clear();
        session.activeToolNames.clear();
        session.hadToolsInTurn = false;
        session.lastActivityAt = Date.now();
        changed = true;
      }
    } else if (
      record.type === 'system' &&
      record.subtype === 'turn_duration'
    ) {
      session.activity = 'idle';
      session.statusText = 'Waiting for input';
      session.activeToolIds.clear();
      session.activeToolNames.clear();
      session.hadToolsInTurn = false;
      changed = true;
    } else if (record.type === 'progress') {
      const data = record.data as Record<string, unknown> | undefined;
      if (data?.type === 'tool_permission_request') {
        session.activity = 'permission';
        session.statusText = 'Needs permission';
        session.lastActivityAt = Date.now();
        changed = true;
      }
    }
  } catch {
    // Ignore malformed lines
  }
  return changed;
}
