import type {AgentActivity} from './types.js';

interface CharacterFrame {
  art: string;
  label: string;
}

const characters: Record<AgentActivity, CharacterFrame> = {
  waiting: {
    art: '(·‿·)',
    label: 'Waiting',
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
  question: {
    art: '(·_·)?',
    label: 'Question',
  },
};

export function getCharacter(activity: AgentActivity): CharacterFrame {
  return characters[activity];
}

export function getActivityColor(activity: AgentActivity): string {
  switch (activity) {
    case 'waiting':
      return 'white';
    case 'active':
    case 'thinking':
    case 'reading':
      return 'cyan';
    case 'editing':
    case 'question':
      return 'yellow';
    case 'running':
      return 'green';
    case 'searching':
      return 'magenta';
    case 'permission':
      return 'red';
  }
}
