import type { BackgroundTaskManager } from '../background';
import type { UltraworkLaunchResult, UltraworkTaskInput } from './types';

export function launchUltraworkTasks(input: {
  manager: BackgroundTaskManager;
  parentSessionID: string;
  tasks: UltraworkTaskInput[];
}): UltraworkLaunchResult[] {
  const uniqueTasks = input.tasks
    .filter((task) => task.agent.trim() && task.prompt.trim())
    .slice(0, 20);

  return uniqueTasks.map((task) => {
    const launched = input.manager.launch({
      agent: task.agent,
      prompt: task.prompt,
      description: task.description,
      parentSessionId: input.parentSessionID,
    });
    return {
      taskID: launched.id,
      agent: launched.agent,
      status: launched.status,
    };
  });
}

