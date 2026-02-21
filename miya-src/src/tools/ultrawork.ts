import {
  type PluginInput,
  type ToolDefinition,
  tool,
} from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
import {
  formatUltraworkDagResult,
  launchUltraworkTasks,
  mergeUltraworkResults,
  runUltraworkDag,
} from '../ultrawork';

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
            id: z.string().optional(),
            agent: z.string(),
            prompt: z.string(),
            description: z.string(),
            dependsOn: z.array(z.string()).optional(),
            timeoutMs: z.number().optional(),
            maxRetries: z.number().optional(),
          }),
        )
        .describe('Parallel task list'),
      mode: z
        .enum(['parallel', 'dag'])
        .optional()
        .describe(
          'Scheduling mode: parallel fire-and-merge or DAG dependency scheduling',
        ),
      max_parallel: z
        .number()
        .optional()
        .describe('Max parallel workers when mode=dag'),
    },
    async execute(args, ctx) {
      const parentSessionID = sessionID(ctx);
      const tasks = Array.isArray(args.tasks) ? args.tasks : [];
      if (args.mode === 'dag') {
        const dagResult = await runUltraworkDag({
          manager,
          parentSessionID,
          tasks,
          maxParallel:
            typeof args.max_parallel === 'number'
              ? Number(args.max_parallel)
              : undefined,
        });
        return ['mode=dag', formatUltraworkDagResult(dagResult)].join('\n');
      }

      const launched = launchUltraworkTasks({
        manager,
        parentSessionID,
        tasks,
      });
      const merged = mergeUltraworkResults(
        manager,
        launched.map((item) => item.taskID),
      );
      return [
        'mode=parallel',
        `launched=${launched.length}`,
        ...launched.map(
          (item) =>
            `- ${item.nodeID} -> ${item.taskID} | ${item.agent} | ${item.status}`,
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
