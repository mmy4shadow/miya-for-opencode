import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
import {
  configureAutoflowSession,
  getAutoflowSession,
  runAutoflow,
  stopAutoflowSession,
} from '../autoflow';

const z = tool.schema;

function getSessionID(ctx: unknown): string {
  if (ctx && typeof ctx === 'object' && 'sessionID' in ctx) {
    return String((ctx as { sessionID?: unknown }).sessionID ?? 'main');
  }
  return 'main';
}

function formatStateSummary(state: ReturnType<typeof getAutoflowSession>): string[] {
  return [
    `session=${state.sessionID}`,
    `phase=${state.phase}`,
    `goal=${state.goal || '(empty)'}`,
    `tasks=${state.planTasks.length}`,
    `fix_round=${state.fixRound}/${state.maxFixRounds}`,
    `verification_command=${state.verificationCommand ?? '(none)'}`,
    `fix_commands=${state.fixCommands.length}`,
    `last_error=${state.lastError ?? '(none)'}`,
    `recent_verification_fingerprints=${state.recentVerificationHashes.length}`,
    `history=${state.history.length}`,
  ];
}

export function createAutoflowTools(
  projectDir: string,
  manager: BackgroundTaskManager,
): Record<string, ToolDefinition> {
  const miya_autoflow = tool({
    description:
      'Persistent autonomous workflow: parallel task execution + verification + iterative fixes until success or hard stop.',
    args: {
      mode: z
        .enum(['start', 'run', 'status', 'stop'])
        .default('run')
        .describe('start configures plan, run executes loop, status inspects, stop halts session'),
      session_id: z.string().optional().describe('Target session id (default current session)'),
      goal: z.string().optional().describe('Workflow goal summary'),
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
        .optional()
        .describe('Planned DAG tasks'),
      verification_command: z
        .string()
        .optional()
        .describe('Verification command after execution'),
      fix_commands: z
        .array(z.string())
        .optional()
        .describe('Fix commands executed round-by-round when verification fails'),
      max_fix_rounds: z.number().optional().describe('Maximum verification-fix rounds'),
      max_parallel: z.number().optional().describe('DAG worker concurrency'),
      timeout_ms: z.number().optional().describe('Shell command timeout'),
      working_directory: z.string().optional().describe('Shell command cwd'),
      force_restart: z
        .boolean()
        .optional()
        .describe('Reset finished/failed state and rerun from planning'),
    },
    async execute(args, ctx) {
      const sessionID =
        typeof args.session_id === 'string' && args.session_id.trim().length > 0
          ? args.session_id.trim()
          : getSessionID(ctx);
      const mode = String(args.mode ?? 'run');

      if (mode === 'status') {
        const state = getAutoflowSession(projectDir, sessionID);
        return formatStateSummary(state).join('\n');
      }

      if (mode === 'stop') {
        const state = stopAutoflowSession(projectDir, sessionID);
        return [...formatStateSummary(state), 'autoflow=stopped'].join('\n');
      }

      if (mode === 'start') {
        const state = configureAutoflowSession(projectDir, {
          sessionID,
          goal: typeof args.goal === 'string' ? args.goal : undefined,
          tasks: Array.isArray(args.tasks) ? args.tasks : undefined,
          verificationCommand:
            typeof args.verification_command === 'string'
              ? args.verification_command
              : undefined,
          fixCommands: Array.isArray(args.fix_commands) ? args.fix_commands : undefined,
          maxFixRounds:
            typeof args.max_fix_rounds === 'number'
              ? Number(args.max_fix_rounds)
              : undefined,
          phase: 'planning',
        });
        return [...formatStateSummary(state), 'autoflow=configured'].join('\n');
      }

      const result = await runAutoflow({
        projectDir,
        sessionID,
        manager,
        goal: typeof args.goal === 'string' ? args.goal : undefined,
        tasks: Array.isArray(args.tasks) ? args.tasks : undefined,
        verificationCommand:
          typeof args.verification_command === 'string'
            ? args.verification_command
            : undefined,
        fixCommands: Array.isArray(args.fix_commands) ? args.fix_commands : undefined,
        maxFixRounds:
          typeof args.max_fix_rounds === 'number' ? Number(args.max_fix_rounds) : undefined,
        maxParallel:
          typeof args.max_parallel === 'number' ? Number(args.max_parallel) : undefined,
        timeoutMs: typeof args.timeout_ms === 'number' ? Number(args.timeout_ms) : undefined,
        workingDirectory:
          typeof args.working_directory === 'string'
            ? args.working_directory
            : undefined,
        forceRestart: Boolean(args.force_restart),
      });

      const lines = [
        `autoflow_success=${result.success}`,
        `summary=${result.summary}`,
        ...formatStateSummary(result.state),
      ];
      if (result.dagResult) {
        lines.push(
          `dag_total=${result.dagResult.total}`,
          `dag_completed=${result.dagResult.completed}`,
          `dag_failed=${result.dagResult.failed}`,
          `dag_blocked=${result.dagResult.blocked}`,
        );
      }
      if (result.verification) {
        lines.push(
          `verification_ok=${result.verification.ok}`,
          `verification_exit=${result.verification.exitCode}`,
          `verification_duration_ms=${result.verification.durationMs}`,
        );
      }
      if (result.fixResult) {
        lines.push(
          `fix_ok=${result.fixResult.ok}`,
          `fix_exit=${result.fixResult.exitCode}`,
          `fix_duration_ms=${result.fixResult.durationMs}`,
        );
      }
      return lines.join('\n');
    },
  });

  return {
    miya_autoflow,
  };
}
