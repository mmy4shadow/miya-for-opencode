import { describe, expect, test } from 'bun:test';
import { safeInterval } from './safe-interval';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('safeInterval', () => {
  test('captures task errors and reports through onError', async () => {
    const errors: Array<{ taskName: string; consecutiveErrors: number }> = [];
    const timer = safeInterval(
      'unit.fail_once',
      10,
      async () => {
        throw new Error('boom');
      },
      {
        maxConsecutiveErrors: 2,
        cooldownMs: 40,
        onError: (input) => {
          errors.push({
            taskName: input.taskName,
            consecutiveErrors: input.consecutiveErrors,
          });
        },
      },
    );
    await sleep(55);
    clearInterval(timer);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((item) => item.taskName === 'unit.fail_once')).toBe(
      true,
    );
  });

  test('skips overlapping async runs', async () => {
    let runs = 0;
    const timer = safeInterval('unit.no_overlap', 10, async () => {
      runs += 1;
      await sleep(35);
    });
    await sleep(90);
    clearInterval(timer);
    expect(runs).toBeLessThanOrEqual(3);
    expect(runs).toBeGreaterThanOrEqual(2);
  });
});
