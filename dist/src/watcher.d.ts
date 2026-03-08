import type { AgentSession, DiscoveredSession } from './types.js';
export declare function createSession(discovered: DiscoveredSession): AgentSession;
export declare function readNewLines(session: AgentSession): boolean;
export declare function startWatching(session: AgentSession, onChange: () => void): () => void;
