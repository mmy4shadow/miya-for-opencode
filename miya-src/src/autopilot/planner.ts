import type { AutopilotPlan, AutopilotPlanStep } from './types';

function splitGoal(goal: string): string[] {
  const chunks = goal
    .split(/[\n.;。；]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (chunks.length > 0) return chunks;
  return [goal.trim()].filter(Boolean);
}

export function createAutopilotPlan(goal: string): AutopilotPlan {
  const goalChunks = splitGoal(goal);
  const steps = goalChunks.map((title, index) => ({
    // Keep kind strongly typed for downstream step rendering.
    kind: (index === goalChunks.length - 1
      ? 'execution'
      : 'analysis') as AutopilotPlanStep['kind'],
    id: `step_${index + 1}`,
    title,
    done: false,
  }));

  return {
    goal: goal.trim(),
    createdAt: new Date().toISOString(),
    steps,
  };
}

export function attachCommandSteps(
  plan: AutopilotPlan,
  commands: string[],
  verificationCommand?: string,
): AutopilotPlan {
  const commandSteps = commands
    .map((command, index) => {
      const text = String(command).trim();
      if (!text) return null;
      return {
        id: `exec_${index + 1}`,
        title: `Execute command #${index + 1}`,
        kind: 'execution' as const,
        command: text,
        done: false,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const verificationStep = verificationCommand?.trim()
    ? [
        {
          id: 'verify_1',
          title: 'Verify execution result',
          kind: 'verification' as const,
          command: verificationCommand.trim(),
          done: false,
        },
      ]
    : [];

  return {
    ...plan,
    steps: [...plan.steps, ...commandSteps, ...verificationStep],
  };
}
