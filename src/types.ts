export type AgentActivity =
  | 'idle'
  | 'active'
  | 'reading'
  | 'editing'
  | 'running'
  | 'searching'
  | 'permission'
  | 'thinking';

export interface AgentSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  gitBranch: string;
  activity: AgentActivity;
  statusText: string;
  lastActivityAt: number;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolNames: Map<string, string>;
  hadToolsInTurn: boolean;
}

export interface DiscoveredSession {
  sessionId: string;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  modifiedAt: number;
}
