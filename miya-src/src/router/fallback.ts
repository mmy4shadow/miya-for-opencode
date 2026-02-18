import { type RouteIntent, recommendedAgent } from './classifier';

export function resolveFallbackAgent(
  intent: RouteIntent,
  availableAgents: string[],
): string {
  const primary = recommendedAgent(intent);
  if (availableAgents.includes(primary)) return primary;
  if (availableAgents.includes('1-task-manager')) return '1-task-manager';
  return availableAgents[0] ?? primary;
}

export function resolveAgentWithFeedback(
  intent: RouteIntent,
  availableAgents: string[],
  ranked: Array<{ agent: string; score: number }>,
): string {
  const base = resolveFallbackAgent(intent, availableAgents);
  if (ranked.length === 0) return base;
  const preferred = ranked.find(
    (item) => availableAgents.includes(item.agent) && item.score >= 0.55,
  );
  return preferred?.agent ?? base;
}
