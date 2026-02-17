import { describe, expect, test } from 'bun:test';
import { buildDesktopActionPlanV2FromRequest } from './action-engine';
import { executeDesktopActionPlan } from './runtime';

describe('desktop runtime v2', () => {
  test('supports dry-run execution without side effects', async () => {
    const plan = buildDesktopActionPlanV2FromRequest({
      source: 'runtime.test',
      appName: 'Calculator',
      actions: [
        {
          id: 'focus_calc',
          kind: 'focus',
          target: {
            mode: 'window',
            value: 'Calculator',
          },
        },
        {
          id: 'assert_calc',
          kind: 'assert',
          assert: {
            type: 'window',
            expected: 'Calculator',
          },
        },
      ],
    });

    const result = await executeDesktopActionPlan({
      projectDir: process.cwd(),
      plan,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.executedCount).toBe(0);
    expect(result.steps.length).toBe(2);
    expect(result.steps[0]?.status).toBe('planned');
    expect(result.plannedCount).toBe(2);
    expect(result.remainingCount).toBe(0);
    expect(result.retryClass).toBe('none');
    expect(result.recoveryAdvice).toBe('none');
    expect(result.nextActionHint).toBe('done');
  });

  test('supports single-step dry-run with remaining action count', async () => {
    const plan = buildDesktopActionPlanV2FromRequest({
      source: 'runtime.single-step.test',
      appName: 'Notepad',
      actions: [
        {
          id: 'focus_notepad',
          kind: 'focus',
          target: {
            mode: 'window',
            value: 'Notepad',
          },
        },
        {
          id: 'type_text',
          kind: 'type',
          text: 'hello',
        },
      ],
    });

    const result = await executeDesktopActionPlan({
      projectDir: process.cwd(),
      plan,
      dryRun: true,
      singleStep: true,
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.steps.length).toBe(1);
    expect(result.plannedCount).toBe(1);
    expect(result.remainingCount).toBe(1);
    expect(result.retryCount).toBe(0);
    expect(result.retryClass).toBe('none');
    expect(result.recoveryAdvice).toBe('none');
    expect(result.nextActionHint).toBe('decide_next_step');
  });
});
