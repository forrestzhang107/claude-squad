import {describe, it, expect} from 'vitest';
import {formatDuration} from '../../src/components/AgentCard.js';

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(90000)).toBe('1m');
    expect(formatDuration(5 * 60 * 1000)).toBe('5m');
    expect(formatDuration(59 * 60 * 1000)).toBe('59m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(60 * 60 * 1000)).toBe('1h');
    expect(formatDuration(60 * 60 * 1000 + 30 * 60 * 1000)).toBe('1h30m');
    expect(formatDuration(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe('2h15m');
  });

  it('omits minutes when exactly on the hour', () => {
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe('3h');
  });

  it('handles sub-second durations', () => {
    expect(formatDuration(500)).toBe('0s');
  });
});
