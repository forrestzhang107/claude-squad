import type {AgentActivity} from './types.js';

interface CharacterFrame {
  art: string;
  label: string;
}

const BORED_ART_MS = 10 * 60 * 1000; // 10 minutes

const characters: Record<AgentActivity, CharacterFrame> = {
  waiting: {
    art: '(·‿·)',
    label: 'Waiting',
  },
  inactive: {
    art: '(-_-)zzZ',
    label: 'Inactive',
  },
  active: {
    art: '(^_^)♪',
    label: 'Working',
  },
  thinking: {
    art: '(o.o)...',
    label: 'Thinking',
  },
  reading: {
    art: '(o_o) ',
    label: 'Reading',
  },
  editing: {
    art: '(*_*)~',
    label: 'Editing',
  },
  running: {
    art: '(·_·)>_',
    label: 'Running',
  },
  searching: {
    art: '(o_o)?',
    label: 'Searching',
  },
  permission: {
    art: '(>_<)!',
    label: 'Blocked',
  },
};

const boredFrame: CharacterFrame = {
  art: '(._.)',
  label: 'Waiting',
};

export function getCharacter(activity: AgentActivity, waitingDurationMs = 0): CharacterFrame {
  if (activity === 'waiting' && waitingDurationMs > BORED_ART_MS) {
    return boredFrame;
  }
  return characters[activity];
}

export function getActivityColor(activity: AgentActivity): string {
  switch (activity) {
    case 'waiting':
      return 'white';
    case 'inactive':
      return 'gray';
    case 'active':
    case 'thinking':
    case 'reading':
      return 'cyan';
    case 'editing':
      return 'yellow';
    case 'running':
      return 'green';
    case 'searching':
      return 'magenta';
    case 'permission':
      return 'red';
  }
}
