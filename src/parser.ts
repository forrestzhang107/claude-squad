import * as path from 'node:path';
import type {AgentActivity, AgentSession} from './types.js';

const BASH_CMD_MAX = 40;
const MAX_HISTORY = 4;
const MIN_TASK_LENGTH = 20;

function formatToolStatus(
  toolName: string,
  input: Record<string, unknown>,
): {activity: AgentActivity; statusText: string; file?: string} {
  const base = (p: unknown) =>
    typeof p === 'string' ? path.basename(p) : '';

  switch (toolName) {
    case 'Read':
      return {activity: 'reading', statusText: `Reading ${base(input.file_path)}`, file: base(input.file_path)};
    case 'Edit':
      return {activity: 'editing', statusText: `Editing ${base(input.file_path)}`, file: base(input.file_path)};
    case 'Write':
      return {activity: 'editing', statusText: `Writing ${base(input.file_path)}`, file: base(input.file_path)};
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

function addHistory(session: AgentSession, tool: string, status: string): void {
  session.toolHistory.push({tool, status, timestamp: Date.now()});
  if (session.toolHistory.length > MAX_HISTORY) {
    session.toolHistory.shift();
  }
}

export function processLine(session: AgentSession, line: string): boolean {
  let changed = false;
  try {
    const record = JSON.parse(line);

    // Capture session start time from the first timestamped record
    if (record.timestamp && !session.sessionStartedAt) {
      const ts = new Date(record.timestamp).getTime();
      if (ts > 0) {
        session.sessionStartedAt = ts;
        changed = true;
      }
    }

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

        for (const tool of toolUses) {
          const toolName = tool.name || '';
          const {activity, statusText, file} = formatToolStatus(
            toolName,
            tool.input || {},
          );

          if (file) {
            session.currentFile = file;
          }

          // Track subagents
          if (toolName === 'Agent' || toolName === 'Task') {
            session.activeSubagents++;
          }

          if (tool.id) {
            session.activeToolIds.add(tool.id);
            session.activeToolNames.set(tool.id, toolName);
            session.toolUseTimestamps.set(tool.id, Date.now());
          }

          // Use the last tool for display status
          session.activity = activity;
          session.statusText = statusText;

          addHistory(session, toolName, statusText);
        }

        session.lastActivityAt = Date.now();
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
              // Track subagent completion
              const toolName = session.activeToolNames.get(block.tool_use_id);
              if (toolName === 'Agent' || toolName === 'Task') {
                session.activeSubagents = Math.max(0, session.activeSubagents - 1);
              }
              session.activeToolIds.delete(block.tool_use_id);
              session.activeToolNames.delete(block.tool_use_id);
              session.toolUseTimestamps.delete(block.tool_use_id);
            }
          }
          if (session.activeToolIds.size === 0) {
            session.hadToolsInTurn = false;
          }
          // Clear permission state once tool results arrive
          if (session.activity === 'permission') {
            session.activity = 'active';
            session.statusText = 'Working...';
          }
          changed = true;
        } else {
          // New user prompt (array form with text blocks)
          const text = content
            .filter((b: {type: string}) => b.type === 'text')
            .map((b: {text?: string}) => b.text || '')
            .join(' ')
            .trim();
          if (text.length >= MIN_TASK_LENGTH) {
            session.taskSummary = text;
          }
          session.activity = 'active';
          session.statusText = 'Starting...';
          session.activeToolIds.clear();
          session.activeToolNames.clear();
          session.toolUseTimestamps.clear();
          session.activeSubagents = 0;
          session.hadToolsInTurn = false;
          session.lastActivityAt = Date.now();
          changed = true;
        }
      } else if (typeof content === 'string' && content.trim()) {
        if (content.trim().length >= MIN_TASK_LENGTH) {
          session.taskSummary = content.trim();
        }
        session.activity = 'active';
        session.statusText = 'Starting...';
        session.activeToolIds.clear();
        session.activeToolNames.clear();
        session.toolUseTimestamps.clear();
        session.activeSubagents = 0;
        session.hadToolsInTurn = false;
        session.lastActivityAt = Date.now();
        changed = true;
      }
    } else if (
      record.type === 'system' &&
      record.subtype === 'turn_duration'
    ) {
      session.activity = 'waiting';
      session.statusText = 'Waiting for input';
      session.activeToolIds.clear();
      session.activeToolNames.clear();
      session.toolUseTimestamps.clear();
      session.activeSubagents = 0;
      session.hadToolsInTurn = false;
      changed = true;
    } else if (record.type === 'progress') {
      const data = record.data as Record<string, unknown> | undefined;
      const dataType = data?.type as string | undefined;
      if (dataType === 'tool_permission_request') {
        session.activity = 'permission';
        session.statusText = 'Needs permission';
        session.lastActivityAt = Date.now();
        changed = true;
      } else if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
        // Tool is still running — reset all timestamps to restart the permission timer
        const now = Date.now();
        for (const id of session.toolUseTimestamps.keys()) {
          session.toolUseTimestamps.set(id, now);
        }
      }
    }
  } catch {
    // Ignore malformed lines
  }
  return changed;
}
