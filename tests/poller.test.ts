import {describe, test, expect} from 'vitest';
import {extractProjectName} from '../src/poller.js';

describe('extractProjectName', () => {
  test('returns basename of absolute path', () => {
    expect(extractProjectName('/Users/forrest/Repos/telvana/telvana-api')).toBe('telvana-api');
  });

  test('returns basename of simple path', () => {
    expect(extractProjectName('/tmp/my-project')).toBe('my-project');
  });

  test('handles trailing slash', () => {
    expect(extractProjectName('/Users/forrest/Repos/project/')).toBe('project');
  });

  test('handles root', () => {
    expect(extractProjectName('/')).toBe('/');
  });
});
