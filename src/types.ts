export type AgentActivity =
  | 'waiting'
  | 'inactive'
  | 'active'
  | 'reading'
  | 'editing'
  | 'running'
  | 'searching'
  | 'permission'
  | 'question'
  | 'thinking';

export interface AgentSession {
  pid: number;
  tty: string;
  processStartedAt: number;
  projectName: string;
  workingDirectory: string;
  gitBranch: string;
  activity: AgentActivity;
  statusText: string;
  lastActivityAt: number;
  lastPrompt: string;
  lastResponse: string[];
}
