import type {AgentSession} from '../src/types.js';

/** Join strings with newlines for test readability. */
export function lines(...args: string[]): string {
  return args.join('\n');
}

/** Create a minimal AgentSession for testing. */
export function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    pid: 12345,
    tty: '/dev/ttys001',
    processStartedAt: Date.now() - 60000,
    projectName: 'test-project',
    workingDirectory: '/tmp/test-project',
    gitBranch: 'main',
    activity: 'waiting',
    statusText: 'Waiting for input',
    lastActivityAt: Date.now(),
    ...overrides,
  };
}
