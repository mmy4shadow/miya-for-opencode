import type { AutopilotPlan } from './types';

export function summarizeAutopilotPlan(plan: AutopilotPlan): string {
  const steps =
    plan.steps.length === 0
      ? '- (no parsed steps)'
      : plan.steps.map((step) => `- ${step.id}: ${step.title}`).join('\n');
  return [`goal=${plan.goal}`, `steps=${plan.steps.length}`, steps].join('\n');
}

