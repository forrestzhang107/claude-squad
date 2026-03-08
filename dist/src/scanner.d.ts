import type { DiscoveredSession } from './types.js';
export declare function extractProjectName(dirName: string): string;
export declare function scanSessions(options: {
    showAll?: boolean;
    projectFilter?: string;
}): DiscoveredSession[];
