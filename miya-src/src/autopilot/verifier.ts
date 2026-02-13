import type { AutopilotPlan } from './types';
import type { AutopilotCommandResult } from './types';

export function summarizeAutopilotPlan(plan: AutopilotPlan): string {
  const steps =
    plan.steps.length === 0
      ? '- (no parsed steps)'
      : plan.steps
          .map((step) => {
            const tail = step.command ? ` -> ${step.command}` : '';
            return `- ${step.id}: [${step.kind}] ${step.title}${tail}`;
          })
          .join('\n');
  return [`goal=${plan.goal}`, `steps=${plan.steps.length}`, steps].join('\n');
}

export function summarizeVerification(
  result: AutopilotCommandResult | undefined,
): string {
  if (!result) return 'verification=skipped';
  return [
    `verification_ok=${result.ok}`,
    `verification_exit=${result.exitCode}`,
    `verification_duration_ms=${result.durationMs}`,
  ].join('\n');
}
