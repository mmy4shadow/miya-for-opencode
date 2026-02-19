import { describe, expect, test } from 'bun:test';
import {
  PERMISSION_CANONICAL_EVENTS,
  adaptPermissionLifecycle,
} from '../../src/contracts/permission-events';

describe('event system integrity: permission lifecycle', () => {
  test('normalizes and de-duplicates pattern values', () => {
    const lifecycle = adaptPermissionLifecycle(
      {
        sessionID: 's-1',
        type: 'bash',
        pattern: ['  ', 'write', 'write', 3 as unknown as string, null as unknown as string],
      },
      { status: 'allow' },
    );

    expect(lifecycle.asked.patterns).toEqual(['write', '3']);
  });

  test('keeps canonical asked/replied event names and drops invalid status', () => {
    const lifecycle = adaptPermissionLifecycle(
      {
        type: 'read',
      },
      { status: 'unexpected' as 'allow' },
    );

    expect(lifecycle.asked.event).toBe(PERMISSION_CANONICAL_EVENTS.asked);
    expect(lifecycle.replied.event).toBe(PERMISSION_CANONICAL_EVENTS.replied);
    expect(lifecycle.asked.sessionID).toBe('main');
    expect(lifecycle.replied.status).toBeUndefined();
  });
});
