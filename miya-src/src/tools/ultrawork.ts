import { type PluginInput, type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
import { mergeUltraworkResults, launchUltraworkTasks } from '../ultrawork';

const z = tool.schema;

function sessionID(ctx: unknown): string {
  if (ctx && typeof ctx === 'object' && 'sessionID' in ctx) {
    return String((ctx as { sessionID?: unknown }).sessionID ?? 'main');
  }
  return 'main';
}

export function createUltraworkTools(
  _ctx: PluginInput,
  manager: BackgroundTaskManager,
): Record<string, ToolDefinition> {
  const miya_ultrawork = tool({
    description:
      'Launch multiple specialist tasks in parallel and return aggregated status.',
    args: {
      tasks: z
        .array(
          z.object({
            agent: z.string(),
            prompt: z.string(),
            description: z.string(),
          }),
        )
        .describe('Parallel task list'),
    },
    async execute(args, ctx) {
      const parentSessionID = sessionID(ctx);
      const launched = launchUltraworkTasks({
        manager,
        parentSessionID,
        tasks: Array.isArray(args.tasks) ? args.tasks : [],
      });
      const merged = mergeUltraworkResults(
        manager,
        launched.map((item) => item.taskID),
      );
      return [
        `launched=${launched.length}`,
        ...launched.map(
          (item) => `- ${item.taskID} | ${item.agent} | ${item.status}`,
        ),
        '',
        'status:',
        merged,
      ].join('\n');
    },
  });

  return {
    miya_ultrawork,
  };
}

