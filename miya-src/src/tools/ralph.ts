import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { executeRalphLoop } from '../ralph';

const z = tool.schema;

export function createRalphTools(): Record<string, ToolDefinition> {
  const miya_ralph_loop = tool({
    description:
      'Execute a verification-driven self-correction loop with optional task and fix commands.',
    args: {
      task_description: z.string().describe('Human-readable task objective'),
      verification_command: z.string().describe('Command used to verify success'),
      max_iterations: z.number().default(8),
      max_retries: z
        .number()
        .optional()
        .describe('Alias of max_iterations for retry-oriented workflows'),
      timeout_ms: z.number().default(60000),
      budget_ms: z
        .number()
        .optional()
        .describe('Total loop time budget. Stops once exceeded.'),
      stall_window: z
        .number()
        .default(3)
        .describe('Consecutive no-progress window before loop stops'),
      error_similarity_threshold: z
        .number()
        .default(0.9)
        .describe('Error similarity threshold used by stall detection'),
      same_line_touch_limit: z
        .number()
        .default(5)
        .describe('Stop when same line keeps churning above this limit'),
      task_command: z
        .string()
        .optional()
        .describe('Optional command to execute the task before verification'),
      fix_commands: z
        .array(z.string())
        .optional()
        .describe('Ordered fix commands executed when verification fails'),
      working_directory: z
        .string()
        .optional()
        .describe('Optional command working directory'),
    },
    async execute(args) {
      const result = executeRalphLoop({
        taskDescription: String(args.task_description),
        verificationCommand: String(args.verification_command),
        maxIterations:
          typeof args.max_retries === 'number'
            ? Number(args.max_retries)
            : typeof args.max_iterations === 'number'
              ? Number(args.max_iterations)
              : 8,
        timeoutMs: typeof args.timeout_ms === 'number' ? Number(args.timeout_ms) : 60000,
        budgetMs: typeof args.budget_ms === 'number' ? Number(args.budget_ms) : undefined,
        stallWindow:
          typeof args.stall_window === 'number' ? Number(args.stall_window) : undefined,
        errorSimilarityThreshold:
          typeof args.error_similarity_threshold === 'number'
            ? Number(args.error_similarity_threshold)
            : undefined,
        sameLineTouchLimit:
          typeof args.same_line_touch_limit === 'number'
            ? Number(args.same_line_touch_limit)
            : undefined,
        taskCommand: args.task_command ? String(args.task_command) : undefined,
        fixCommands: Array.isArray(args.fix_commands)
          ? args.fix_commands.map(String)
          : undefined,
        workingDirectory: args.working_directory
          ? String(args.working_directory)
          : undefined,
      });

      const lines = [
        `task=${String(args.task_description)}`,
        `success=${result.success}`,
        `iterations=${result.iterations}`,
        `reason=${result.reason ?? 'unknown'}`,
        `summary=${result.summary}`,
      ];

      const tailAttempts = result.attempts.slice(-6);
      if (tailAttempts.length > 0) {
        lines.push('recent_attempts=');
        for (const attempt of tailAttempts) {
          lines.push(
            [
              `- #${attempt.iteration}`,
              attempt.type,
              `ok=${attempt.result.ok}`,
              `exit=${attempt.result.exitCode}`,
              attempt.noProgress ? 'no_progress=true' : '',
              typeof attempt.errorSimilarity === 'number'
                ? `error_similarity=${attempt.errorSimilarity.toFixed(3)}`
                : '',
              attempt.failureKind ? `failure=${attempt.failureKind}` : '',
              attempt.result.stderr.trim()
                ? `stderr=${attempt.result.stderr.trim().slice(0, 220).replace(/\s+/g, ' ')}`
                : '',
            ]
              .filter(Boolean)
              .join(' | '),
          );
        }
      }

      return lines.join('\n');
    },
  });

  return {
    miya_ralph_loop,
  };
}
