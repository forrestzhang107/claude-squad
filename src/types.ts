export type AgentActivity =
  | 'waiting'
  | 'stale'
  | 'active'
  | 'reading'
  | 'editing'
  | 'running'
  | 'searching'
  | 'permission'
  | 'thinking';

export interface ToolHistoryEntry {
  tool: string;
  status: string;
  timestamp: number;
}

export interface AgentSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  gitBranch: string;
  activity: AgentActivity;
  statusText: string;
  lastActivityAt: number;
  sessionStartedAt: number;
  currentFile: string;
  toolHistory: ToolHistoryEntry[];
  activeSubagents: number;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolNames: Map<string, string>;
  toolUseTimestamps: Map<string, number>;
  hadToolsInTurn: boolean;
  respondedAt: number; // when we last saw a text-only assistant message
  pendingSubagentToolIds: Set<string>;
  subagentToolTimestamps: Map<string, number>;
  taskSummary: string;
  workingDirectory: string;
  repoName: string;
  recentPaths: string[];
  contextTokens: number;
  contextMaxTokens: number;
  lastResponseText: string;
}

export interface DiscoveredSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  modifiedAt: number;
  createdAt: number;
}
