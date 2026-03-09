import {describe, it, expect, beforeEach} from 'vitest';
import {
  processLine,
  stripEmoji,
  stripSystemTags,
  cleanPrompt,
  extractText,
  formatToolStatus,
  detectWorkingDirectory,
  applyNewPrompt,
  resetToolState,
} from '../src/parser.js';
import type {AgentSession} from '../src/types.js';
import {
  makeSession,
  assistantToolUse,
  assistantText,
  assistantThinking,
  assistantTextAndTool,
  assistantWithUsage,
  userToolResult,
  userPrompt,
  userPromptString,
  systemTurnDuration,
  systemStopHookSummary,
  lastPrompt,
  progressPermissionRequest,
  progressBash,
  progressMcp,
  progressAgentToolUse,
  progressAgentToolResult,
  recordWithTimestamp,
  recordWithBranch,
} from './helpers.js';

// ── stripEmoji ──

describe('stripEmoji', () => {
  it('removes emoji characters', () => {
    expect(stripEmoji('hello 🎉 world')).toBe('hello  world');
  });

  it('leaves plain text unchanged', () => {
    expect(stripEmoji('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(stripEmoji('')).toBe('');
  });
});

// ── stripSystemTags ──

describe('stripSystemTags', () => {
  it('removes paired XML tags', () => {
    expect(stripSystemTags('hello <system-reminder>stuff</system-reminder> world')).toBe('hello  world');
  });

  it('removes self-closing tags', () => {
    expect(stripSystemTags('hello <tag/> world')).toBe('hello  world');
  });

  it('leaves normal text unchanged', () => {
    expect(stripSystemTags('just text')).toBe('just text');
  });

  it('handles multiline tag content', () => {
    const input = 'before <system-reminder>\nline1\nline2\n</system-reminder> after';
    expect(stripSystemTags(input)).toBe('before  after');
  });
});

// ── cleanPrompt ──

describe('cleanPrompt', () => {
  it('strips both emoji and system tags', () => {
    const input = '🎯 Do something <system-reminder>hidden</system-reminder>';
    expect(cleanPrompt(input)).toBe('Do something');
  });
});

// ── extractText ──

describe('extractText', () => {
  it('joins text blocks', () => {
    const blocks = [
      {type: 'text', text: 'hello'},
      {type: 'tool_use'},
      {type: 'text', text: 'world'},
    ];
    expect(extractText(blocks)).toBe('hello world');
  });

  it('returns empty for no text blocks', () => {
    expect(extractText([{type: 'thinking'}])).toBe('');
  });

  it('skips blocks without text field', () => {
    expect(extractText([{type: 'text'}])).toBe('');
  });
});

// ── formatToolStatus ──

describe('formatToolStatus', () => {
  it('maps Read to reading', () => {
    const result = formatToolStatus('Read', {file_path: '/foo/bar.ts'});
    expect(result.activity).toBe('reading');
    expect(result.statusText).toBe('Reading bar.ts');
    expect(result.file).toBe('bar.ts');
  });

  it('maps Edit to editing', () => {
    const result = formatToolStatus('Edit', {file_path: '/foo/baz.ts'});
    expect(result.activity).toBe('editing');
    expect(result.file).toBe('baz.ts');
  });

  it('maps Write to editing', () => {
    const result = formatToolStatus('Write', {file_path: '/foo/new.ts'});
    expect(result.activity).toBe('editing');
  });

  it('maps Bash to running with truncated command', () => {
    const longCmd = 'a'.repeat(50);
    const result = formatToolStatus('Bash', {command: longCmd});
    expect(result.activity).toBe('running');
    expect(result.statusText).toBe(`$ ${'a'.repeat(40)}...`);
  });

  it('maps Bash with short command', () => {
    const result = formatToolStatus('Bash', {command: 'ls -la'});
    expect(result.statusText).toBe('$ ls -la');
  });

  it('maps Glob/Grep to searching', () => {
    expect(formatToolStatus('Glob', {}).activity).toBe('searching');
    expect(formatToolStatus('Grep', {}).activity).toBe('searching');
  });

  it('maps WebFetch/WebSearch to searching', () => {
    expect(formatToolStatus('WebFetch', {}).activity).toBe('searching');
    expect(formatToolStatus('WebSearch', {}).activity).toBe('searching');
    expect(formatToolStatus('WebSearch', {}).statusText).toBe('Searching the web');
  });

  it('maps Agent/Task to running subtask', () => {
    expect(formatToolStatus('Agent', {}).activity).toBe('running');
    expect(formatToolStatus('Agent', {}).statusText).toBe('Running subtask');
    expect(formatToolStatus('Task', {}).activity).toBe('running');
  });

  it('returns active for unknown tools', () => {
    const result = formatToolStatus('CustomTool', {});
    expect(result.activity).toBe('active');
    expect(result.statusText).toBe('Using CustomTool');
  });
});

// ── detectWorkingDirectory ──

describe('detectWorkingDirectory', () => {
  it('returns empty for no paths', () => {
    expect(detectWorkingDirectory([])).toBe('');
  });

  it('finds common deep directory', () => {
    const paths = [
      '/home/user/project/src',
      '/home/user/project/src',
      '/home/user/project/test',
    ];
    const result = detectWorkingDirectory(paths);
    // src appears twice at depth 5, project appears 3 times at depth 4
    // src: 2*5=10, project: 3*4=12 → project wins
    expect(result).toBe('/home/user/project');
  });

  it('prefers deeper directories when frequency is equal', () => {
    const paths = [
      '/a/b/c/d',
      '/a/b/c/d',
    ];
    const result = detectWorkingDirectory(paths);
    // /a/b/c/d: freq=2, depth=5, score=10
    // /a/b/c: freq=2, depth=4, score=8
    expect(result).toBe('/a/b/c/d');
  });

  it('handles single path', () => {
    const result = detectWorkingDirectory(['/home/user/project']);
    expect(result).toBe('/home/user/project');
  });
});

// ── resetToolState ──

describe('resetToolState', () => {
  it('clears all tool tracking fields', () => {
    const session = makeSession();
    session.activeToolIds.add('t1');
    session.activeToolNames.set('t1', 'Read');
    session.toolUseTimestamps.set('t1', 123);
    session.pendingSubagentToolIds.add('s1');
    session.subagentToolTimestamps.set('s1', 456);
    session.activeSubagents = 2;
    session.hadToolsInTurn = true;
    session.respondedAt = 999;

    resetToolState(session);

    expect(session.activeToolIds.size).toBe(0);
    expect(session.activeToolNames.size).toBe(0);
    expect(session.toolUseTimestamps.size).toBe(0);
    expect(session.pendingSubagentToolIds.size).toBe(0);
    expect(session.subagentToolTimestamps.size).toBe(0);
    expect(session.activeSubagents).toBe(0);
    expect(session.hadToolsInTurn).toBe(false);
    expect(session.respondedAt).toBe(0);
  });
});

// ── applyNewPrompt ──

describe('applyNewPrompt', () => {
  it('sets task summary and resets state', () => {
    const session = makeSession();
    const result = applyNewPrompt(session, 'Fix the bug');
    expect(result).toBe(true);
    expect(session.taskSummary).toBe('Fix the bug');
    expect(session.activity).toBe('active');
    expect(session.statusText).toBe('Starting...');
    expect(session.lastResponseText).toBe('');
  });

  it('strips emoji and system tags from prompt', () => {
    const session = makeSession();
    applyNewPrompt(session, '🎯 Do it <system-reminder>x</system-reminder>');
    expect(session.taskSummary).toBe('Do it');
  });

  it('returns false for empty prompt after cleaning', () => {
    const session = makeSession();
    expect(applyNewPrompt(session, '<system-reminder>hidden</system-reminder>')).toBe(false);
  });
});

// ── processLine: assistant records ──

describe('processLine', () => {
  let session: AgentSession;

  beforeEach(() => {
    session = makeSession();
  });

  describe('assistant text-only', () => {
    it('sets active + Responding', () => {
      const changed = processLine(session, assistantText('hello world'));
      expect(changed).toBe(true);
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Responding...');
      expect(session.respondedAt).toBeGreaterThan(0);
    });

    it('captures lastResponseText', () => {
      processLine(session, assistantText('some response'));
      expect(session.lastResponseText).toBe('some response');
    });

    it('truncates lastResponseText to 500 chars', () => {
      processLine(session, assistantText('x'.repeat(600)));
      expect(session.lastResponseText.length).toBe(500);
    });
  });

  describe('assistant thinking', () => {
    it('sets thinking state', () => {
      processLine(session, assistantThinking());
      expect(session.activity).toBe('thinking');
      expect(session.statusText).toBe('Thinking...');
    });
  });

  describe('assistant tool_use', () => {
    it('tracks tool in activeToolIds', () => {
      const line = assistantToolUse('Read', {file_path: '/foo/bar.ts'}, 'tool1');
      processLine(session, line);
      expect(session.activeToolIds.has('tool1')).toBe(true);
      expect(session.activeToolNames.get('tool1')).toBe('Read');
      expect(session.activity).toBe('reading');
      expect(session.currentFile).toBe('bar.ts');
    });

    it('sets hadToolsInTurn and clears respondedAt', () => {
      session.respondedAt = 999;
      processLine(session, assistantToolUse('Read', {}, 'tool1'));
      expect(session.hadToolsInTurn).toBe(true);
      expect(session.respondedAt).toBe(0);
    });

    it('tracks Agent tool as subagent', () => {
      processLine(session, assistantToolUse('Agent', {}, 'agent1'));
      expect(session.activeSubagents).toBe(1);
    });

    it('tracks Task tool as subagent', () => {
      processLine(session, assistantToolUse('Task', {}, 'task1'));
      expect(session.activeSubagents).toBe(1);
    });

    it('handles multiple tools in one message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {type: 'tool_use', id: 't1', name: 'Read', input: {file_path: '/a.ts'}},
            {type: 'tool_use', id: 't2', name: 'Grep', input: {pattern: 'foo'}},
          ],
        },
      });
      processLine(session, line);
      expect(session.activeToolIds.size).toBe(2);
      // Last tool wins for display
      expect(session.activity).toBe('searching');
    });
  });

  describe('assistant text + tool_use mixed', () => {
    it('captures text but sets tool activity', () => {
      const line = assistantTextAndTool('Let me read that', 'Read', {file_path: '/x.ts'}, 'tool1');
      processLine(session, line);
      expect(session.lastResponseText).toBe('Let me read that');
      expect(session.activity).toBe('reading');
      expect(session.respondedAt).toBe(0); // tools clear respondedAt
    });
  });

  describe('tool results (user records)', () => {
    it('removes completed tool from tracking', () => {
      processLine(session, assistantToolUse('Read', {}, 'tool1'));
      expect(session.activeToolIds.size).toBe(1);

      processLine(session, userToolResult('tool1'));
      expect(session.activeToolIds.size).toBe(0);
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Working...');
    });

    it('transitions to Working when all tools complete', () => {
      processLine(session, assistantToolUse('Read', {}, 't1'));
      processLine(session, assistantToolUse('Grep', {}, 't2'));

      processLine(session, userToolResult('t1'));
      // Still one tool active
      expect(session.activeToolIds.size).toBe(1);

      processLine(session, userToolResult('t2'));
      expect(session.activeToolIds.size).toBe(0);
      expect(session.statusText).toBe('Working...');
      expect(session.respondedAt).toBe(0);
    });

    it('decrements subagent count when Agent completes', () => {
      processLine(session, assistantToolUse('Agent', {}, 'agent1'));
      expect(session.activeSubagents).toBe(1);

      processLine(session, userToolResult('agent1'));
      expect(session.activeSubagents).toBe(0);
    });

    it('clears subagent tracking when last subagent completes', () => {
      processLine(session, assistantToolUse('Agent', {}, 'agent1'));
      session.pendingSubagentToolIds.add('sub1');
      session.subagentToolTimestamps.set('sub1', Date.now());

      processLine(session, userToolResult('agent1'));
      expect(session.pendingSubagentToolIds.size).toBe(0);
      expect(session.subagentToolTimestamps.size).toBe(0);
    });

    it('clears permission state on tool result', () => {
      processLine(session, assistantToolUse('Bash', {}, 't1'));
      processLine(session, assistantToolUse('Read', {}, 't2'));
      session.activity = 'permission';

      // Complete one tool but not all
      processLine(session, userToolResult('t1'));
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Working...');
    });
  });

  describe('user prompts', () => {
    it('starts new task from array content', () => {
      processLine(session, userPrompt('Fix the login bug'));
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Starting...');
      expect(session.taskSummary).toBe('Fix the login bug');
    });

    it('starts new task from string content', () => {
      processLine(session, userPromptString('Deploy to prod'));
      expect(session.taskSummary).toBe('Deploy to prod');
    });

    it('handles Ctrl+C interrupt', () => {
      const line = userPrompt('[Request interrupted by user]');
      processLine(session, line);
      expect(session.activity).toBe('waiting');
      expect(session.statusText).toBe('Interrupted');
    });

    it('ignores empty prompts after cleaning', () => {
      const line = userPrompt('<system-reminder>nothing</system-reminder>');
      const changed = processLine(session, line);
      expect(changed).toBe(false);
    });
  });

  describe('system records', () => {
    it('turn_duration transitions to waiting', () => {
      session.activity = 'active';
      processLine(session, systemTurnDuration());
      expect(session.activity).toBe('waiting');
      expect(session.statusText).toBe('Waiting for input');
    });

    it('stop_hook_summary transitions to waiting', () => {
      session.activity = 'running';
      processLine(session, systemStopHookSummary());
      expect(session.activity).toBe('waiting');
    });

    it('resets tool state on turn end', () => {
      session.activeToolIds.add('t1');
      session.respondedAt = 123;
      processLine(session, systemTurnDuration());
      expect(session.activeToolIds.size).toBe(0);
      expect(session.respondedAt).toBe(0);
    });

    it('compact_boundary overrides last-prompt session ended', () => {
      // last-prompt fires before compact_boundary, setting "Session ended"
      processLine(session, lastPrompt());
      expect(session.activity).toBe('waiting');
      expect(session.statusText).toBe('Session ended');

      // compact_boundary corrects this back to active
      processLine(session, JSON.stringify({type: 'system', subtype: 'compact_boundary'}));
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Compacting context...');
    });
  });

  describe('last-prompt', () => {
    it('transitions to session ended', () => {
      session.activity = 'active';
      processLine(session, lastPrompt());
      expect(session.activity).toBe('waiting');
      expect(session.statusText).toBe('Session ended');
    });
  });

  describe('progress records', () => {
    it('tool_permission_request sets permission state', () => {
      processLine(session, progressPermissionRequest());
      expect(session.activity).toBe('permission');
      expect(session.statusText).toBe('Needs permission');
    });

    it('bash_progress clears permission state', () => {
      session.activity = 'permission';
      session.toolUseTimestamps.set('t1', 1000);
      const before = Date.now();
      processLine(session, progressBash());
      expect(session.activity).toBe('running');
      expect(session.statusText).toBe('Running...');
      // Timestamps should be reset to now
      expect(session.toolUseTimestamps.get('t1')!).toBeGreaterThanOrEqual(before);
    });

    it('mcp_progress clears permission state', () => {
      session.activity = 'permission';
      processLine(session, progressMcp());
      expect(session.activity).toBe('running');
    });

    it('bash_progress resets subagent timestamps too', () => {
      session.activity = 'permission';
      session.subagentToolTimestamps.set('s1', 1000);
      const before = Date.now();
      processLine(session, progressBash());
      expect(session.subagentToolTimestamps.get('s1')!).toBeGreaterThanOrEqual(before);
    });

    it('agent_progress tracks subagent tool_use', () => {
      processLine(session, progressAgentToolUse('sub_tool_1'));
      expect(session.pendingSubagentToolIds.has('sub_tool_1')).toBe(true);
      expect(session.subagentToolTimestamps.has('sub_tool_1')).toBe(true);
    });

    it('agent_progress tracks subagent tool_result', () => {
      session.pendingSubagentToolIds.add('sub_tool_1');
      session.subagentToolTimestamps.set('sub_tool_1', Date.now());

      processLine(session, progressAgentToolResult('sub_tool_1'));
      expect(session.pendingSubagentToolIds.has('sub_tool_1')).toBe(false);
      expect(session.subagentToolTimestamps.has('sub_tool_1')).toBe(false);
    });

    it('agent_progress clears permission when all subagent tools done', () => {
      session.activity = 'permission';
      session.pendingSubagentToolIds.add('sub1');
      session.subagentToolTimestamps.set('sub1', Date.now());

      processLine(session, progressAgentToolResult('sub1'));
      expect(session.activity).toBe('running');
      expect(session.statusText).toBe('Running subtask');
    });
  });

  describe('metadata extraction', () => {
    it('captures session start time from first timestamp', () => {
      processLine(session, recordWithTimestamp('2025-01-15T10:00:00Z'));
      expect(session.sessionStartedAt).toBe(new Date('2025-01-15T10:00:00Z').getTime());
    });

    it('does not overwrite session start time', () => {
      processLine(session, recordWithTimestamp('2025-01-15T10:00:00Z'));
      const first = session.sessionStartedAt;
      processLine(session, recordWithTimestamp('2025-01-15T11:00:00Z'));
      expect(session.sessionStartedAt).toBe(first);
    });

    it('captures git branch', () => {
      processLine(session, recordWithBranch('feature/auth'));
      expect(session.gitBranch).toBe('feature/auth');
    });

    it('captures context token usage', () => {
      const line = assistantWithUsage('hello', {
        input_tokens: 1000,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 200,
      });
      processLine(session, line);
      expect(session.contextTokens).toBe(1700);
    });
  });

  describe('tool history', () => {
    it('adds tool use to history', () => {
      processLine(session, assistantToolUse('Read', {file_path: '/foo.ts'}, 't1'));
      expect(session.toolHistory.length).toBe(1);
      expect(session.toolHistory[0].tool).toBe('Read');
    });

    it('limits history to 4 entries', () => {
      for (let i = 0; i < 6; i++) {
        processLine(session, assistantToolUse('Read', {}, `t${i}`));
      }
      expect(session.toolHistory.length).toBe(4);
    });
  });

  describe('working directory detection', () => {
    it('collects file paths from tool inputs', () => {
      processLine(session, assistantToolUse('Read', {file_path: '/home/user/project/src/app.ts'}, 't1'));
      expect(session.recentPaths.length).toBe(1);
      expect(session.recentPaths[0]).toBe('/home/user/project/src');
    });

    it('collects paths from path field', () => {
      processLine(session, assistantToolUse('Glob', {path: '/home/user/project/src'}, 't1'));
      expect(session.recentPaths.length).toBe(1);
    });

    it('limits recent paths to 20', () => {
      for (let i = 0; i < 25; i++) {
        processLine(session, assistantToolUse('Read', {file_path: `/home/user/project/file${i}.ts`}, `t${i}`));
      }
      expect(session.recentPaths.length).toBe(20);
    });
  });

  describe('malformed input', () => {
    it('ignores invalid JSON', () => {
      const changed = processLine(session, 'not json');
      expect(changed).toBe(false);
    });

    it('ignores empty object', () => {
      const changed = processLine(session, '{}');
      expect(changed).toBe(false);
    });
  });

  describe('complex multi-step scenarios', () => {
    it('full turn: prompt → thinking → text → tool → result → text → turn_end', () => {
      // User sends prompt
      processLine(session, userPrompt('Fix the bug'));
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Starting...');
      expect(session.respondedAt).toBe(0);

      // Assistant thinks
      processLine(session, assistantThinking());
      expect(session.activity).toBe('thinking');

      // Assistant responds with text then tool
      processLine(session, assistantTextAndTool('Let me check', 'Read', {file_path: '/src/app.ts'}, 'read1'));
      expect(session.activity).toBe('reading');
      expect(session.respondedAt).toBe(0); // tools clear respondedAt

      // Tool result comes back
      processLine(session, userToolResult('read1'));
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Working...');

      // Assistant gives final text response
      processLine(session, assistantText('I found the issue'));
      expect(session.activity).toBe('active');
      expect(session.statusText).toBe('Responding...');
      expect(session.respondedAt).toBeGreaterThan(0);

      // Turn ends
      processLine(session, systemTurnDuration());
      expect(session.activity).toBe('waiting');
      expect(session.respondedAt).toBe(0);
    });

    it('multiple subagents with tool tracking', () => {
      // Launch two agents
      processLine(session, assistantToolUse('Agent', {}, 'agent1'));
      processLine(session, assistantToolUse('Agent', {}, 'agent2'));
      expect(session.activeSubagents).toBe(2);

      // Subagent 1 starts a tool
      processLine(session, progressAgentToolUse('sub1'));
      expect(session.pendingSubagentToolIds.size).toBe(1);

      // Subagent 1 finishes tool
      processLine(session, progressAgentToolResult('sub1'));
      expect(session.pendingSubagentToolIds.size).toBe(0);

      // Agent 1 completes
      processLine(session, userToolResult('agent1'));
      expect(session.activeSubagents).toBe(1);
      // Subagent tracking NOT cleared yet (still one agent running)
      expect(session.pendingSubagentToolIds.size).toBe(0);

      // Agent 2 completes
      processLine(session, userToolResult('agent2'));
      expect(session.activeSubagents).toBe(0);
    });
  });
});
