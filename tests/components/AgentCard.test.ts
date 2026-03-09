import {describe, it, expect} from 'vitest';
import {formatTokens, formatDuration} from '../../src/components/AgentCard.js';

// ── formatTokens ──

describe('formatTokens', () => {
  it('formats millions', () => {
    expect(formatTokens(1234567)).toBe('1.2M');
    expect(formatTokens(2000000)).toBe('2.0M');
  });

  it('formats thousands', () => {
    expect(formatTokens(45200)).toBe('45.2k');
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(999999)).toBe('1000.0k');
  });

  it('formats small numbers as-is', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1)).toBe('1');
  });

  it('handles boundary values', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(999)).toBe('999');
  });
});

// ── formatDuration ──

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
