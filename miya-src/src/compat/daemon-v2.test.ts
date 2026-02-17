import { describe, expect, test } from 'bun:test';
import { resolveDaemonCompatMethod } from './daemon-v2';

describe('resolveDaemonCompatMethod', () => {
  test('keeps legacy method unchanged', () => {
    expect(resolveDaemonCompatMethod('daemon.status.get')).toBe('daemon.status.get');
  });

  test('maps v2 prefixed method to legacy method', () => {
    expect(resolveDaemonCompatMethod('v2.daemon.status.get')).toBe('daemon.status.get');
  });
});
