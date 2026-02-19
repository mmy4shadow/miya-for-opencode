import { createAutopilotPlan, createPlanBundleV1 } from '../../src/autopilot';

describe('approval fatigue and plan bundle hardening', () => {
  test('normalizes invalid timeout and retry values into safe finite budget', () => {
    const plan = createAutopilotPlan('stabilize plan-bundle runtime guards');
    const bundle = createPlanBundleV1({
      goal: 'stabilize plan-bundle runtime guards',
      plan,
      runInput: {
        goal: 'stabilize plan-bundle runtime guards',
        commands: ['echo ok'],
        timeoutMs: Number.NaN,
        maxRetriesPerCommand: Number.POSITIVE_INFINITY,
        approval: { required: true, autoApprove: false },
        mode: 'work',
        riskTier: 'THOROUGH',
      },
    });

    expect(Number.isFinite(bundle.budget.timeMs)).toBeTrue();
    expect(bundle.budget.timeMs).toBe(60_000);
    expect(bundle.budget.retries).toBe(1);
    expect(bundle.status).toBe('pending_approval');
  });
});
