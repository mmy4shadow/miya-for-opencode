import type { BackgroundTaskManager } from '../background';

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

