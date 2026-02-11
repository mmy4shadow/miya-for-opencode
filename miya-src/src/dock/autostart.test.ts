import { describe, expect, test } from 'bun:test';
import { dockAutostartInternals } from './autostart';

describe('dock autostart internals', () => {
  test('detects default command as tui startup', () => {
    expect(
      dockAutostartInternals.isLikelyTuiStartup(['opencode', 'opencode']),
    ).toBe(true);
  });

  test('detects run/debug as non-tui startup', () => {
    expect(
      dockAutostartInternals.isLikelyTuiStartup([
        'opencode',
        'opencode',
        'run',
      ]),
    ).toBe(false);
    expect(
      dockAutostartInternals.isLikelyTuiStartup([
        'opencode',
        'opencode',
        'debug',
      ]),
    ).toBe(false);
  });
});
