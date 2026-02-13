import { recommendedAgent, type RouteIntent } from './classifier';

export function resolveFallbackAgent(
  intent: RouteIntent,
  availableAgents: string[],
): string {
  const primary = recommendedAgent(intent);
  if (availableAgents.includes(primary)) return primary;
  if (availableAgents.includes('1-task-manager')) return '1-task-manager';
  return availableAgents[0] ?? primary;
}

