import {describe, it, expect} from 'vitest';
import {getCharacter, getActivityColor} from '../src/characters.js';
import type {AgentActivity} from '../src/types.js';

// ── getCharacter ──

describe('getCharacter', () => {
  const allActivities: AgentActivity[] = [
    'waiting', 'inactive', 'active', 'thinking',
    'reading', 'editing', 'running', 'searching', 'permission', 'question',
  ];

  it('returns a frame for every activity', () => {
    for (const activity of allActivities) {
      const frame = getCharacter(activity);
      expect(frame).toBeDefined();
      expect(frame.art).toBeTruthy();
      expect(frame.label).toBeTruthy();
    }
  });

  it('returns normal waiting art for short wait', () => {
    const frame = getCharacter('waiting', 5 * 60 * 1000); // 5 min
    expect(frame.art).toBe('(·‿·)');
  });

  it('returns bored art after 10 minutes of waiting', () => {
    const frame = getCharacter('waiting', 11 * 60 * 1000);
    expect(frame.art).toBe('(._.)')
    expect(frame.label).toBe('Waiting');
  });

  it('returns normal art at exactly 10 minutes', () => {
    const frame = getCharacter('waiting', 10 * 60 * 1000);
    expect(frame.art).toBe('(·‿·)');
  });

  it('does not return bored art for non-waiting activities regardless of duration', () => {
    const frame = getCharacter('active', 20 * 60 * 1000);
    expect(frame.art).not.toBe('(._.)')
  });

  it('returns correct art for each state', () => {
    expect(getCharacter('inactive').art).toBe('(-_-)zzZ');
    expect(getCharacter('active').art).toBe('(^_^)♪');
    expect(getCharacter('thinking').art).toBe('(o.o)...');
    expect(getCharacter('reading').art).toBe('(o_o) ');
    expect(getCharacter('editing').art).toBe('(*_*)~');
    expect(getCharacter('running').art).toBe('(·_·)>_');
    expect(getCharacter('searching').art).toBe('(o_o)?');
    expect(getCharacter('permission').art).toBe('(>_<)!');
    expect(getCharacter('question').art).toBe('(·_·)?');
  });
});

// ── getActivityColor ──

describe('getActivityColor', () => {
  it('maps waiting to white', () => {
    expect(getActivityColor('waiting')).toBe('white');
  });

  it('maps inactive to gray', () => {
    expect(getActivityColor('inactive')).toBe('gray');
  });

  it('maps active/thinking/reading to cyan', () => {
    expect(getActivityColor('active')).toBe('cyan');
    expect(getActivityColor('thinking')).toBe('cyan');
    expect(getActivityColor('reading')).toBe('cyan');
  });

  it('maps editing to yellow', () => {
    expect(getActivityColor('editing')).toBe('yellow');
  });

  it('maps running to green', () => {
    expect(getActivityColor('running')).toBe('green');
  });

  it('maps searching to magenta', () => {
    expect(getActivityColor('searching')).toBe('magenta');
  });

  it('maps permission to red', () => {
    expect(getActivityColor('permission')).toBe('red');
  });

  it('maps question to yellow', () => {
    expect(getActivityColor('question')).toBe('yellow');
  });

  it('returns a value for every activity type', () => {
    const activities: AgentActivity[] = [
      'waiting', 'inactive', 'active', 'thinking',
      'reading', 'editing', 'running', 'searching', 'permission', 'question',
    ];
    for (const a of activities) {
      expect(getActivityColor(a)).toBeTruthy();
    }
  });
});
