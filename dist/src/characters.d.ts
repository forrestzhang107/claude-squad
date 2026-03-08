import type { AgentActivity } from './types.js';
interface CharacterFrame {
    art: string;
    label: string;
}
export declare function getCharacter(activity: AgentActivity): CharacterFrame;
export declare function getActivityColor(activity: AgentActivity): string;
export {};
