import type { AutopilotPlan } from './types';

function splitGoal(goal: string): string[] {
  const chunks = goal
    .split(/[\n.;。；]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (chunks.length > 0) return chunks;
  return [goal.trim()].filter(Boolean);
}

export function createAutopilotPlan(goal: string): AutopilotPlan {
  const steps = splitGoal(goal).map((title, index) => ({
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

