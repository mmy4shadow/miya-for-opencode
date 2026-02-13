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
      max_iterations: z.number().default(5),
      timeout_ms: z.number().default(60000),
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
          typeof args.max_iterations === 'number' ? Number(args.max_iterations) : 5,
        timeoutMs: typeof args.timeout_ms === 'number' ? Number(args.timeout_ms) : 60000,
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
              attempt.failureKind ? `failure=${attempt.failureKind}` : '',
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

