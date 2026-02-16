import type { BackgroundTaskManager } from '../background';
import type { UltraworkDagResult } from './scheduler';

export function mergeUltraworkResults(
  manager: BackgroundTaskManager,
  taskIDs: string[],
): string {
  const lines: string[] = [];
  for (const taskID of taskIDs) {
    const task = manager.getResult(taskID);
    if (!task) {
      lines.push(`- ${taskID}: not_found`);
      continue;
    }
    lines.push(
      `- ${task.id} | ${task.agent} | ${task.status} | ${task.completedAt ? 'done' : 'running'}`,
    );
  }
  return lines.join('\n');
}

export function formatUltraworkDagResult(result: UltraworkDagResult): string {
  const header = [
    `total=${result.total}`,
    `completed=${result.completed}`,
    `failed=${result.failed}`,
    `blocked=${result.blocked}`,
    `critical_path=${result.metrics.criticalPathLength}`,
    `max_parallel_observed=${result.metrics.maxParallelObserved}`,
    `scheduler_ticks=${result.metrics.schedulerTicks}`,
    `wait_ticks=${result.metrics.waitTicks}`,
    `retries_scheduled=${result.metrics.retriesScheduled}`,
  ];
  const lines = result.nodes.map(
    (node) =>
      `- ${node.nodeID} | ${node.agent} | ${node.status} | retries=${node.retries}${node.error ? ` | error=${node.error}` : ''}`,
  );
  return [...header, ...lines].join('\n');
}
