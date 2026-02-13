import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  configureAutopilotSession,
  createAutopilotPlan,
  runAutopilot,
  summarizeAutopilotPlan,
  summarizeVerification,
} from '../autopilot';
import { getSessionState } from '../workflow';

const z = tool.schema;

function getSessionID(ctx: unknown): string {
  if (ctx && typeof ctx === 'object' && 'sessionID' in ctx) {
    return String((ctx as { sessionID?: unknown }).sessionID ?? 'main');
  }
  return 'main';
}

export function createAutopilotTools(
  projectDir: string,
): Record<string, ToolDefinition> {
  const miya_autopilot = tool({
    description:
      'Configure and inspect autopilot loop settings, with lightweight plan generation from goal text.',
    args: {
      mode: z
        .enum(['start', 'stop', 'status', 'run'])
        .default('start')
        .describe(
          'start to enable autopilot, stop to disable, status to inspect, run to execute commands end-to-end',
        ),
      goal: z
        .string()
        .optional()
        .describe('Goal text used to build an execution plan when mode=start'),
      commands: z
        .array(z.string())
        .optional()
        .describe('Commands executed in sequence when mode=run'),
      verification_command: z
        .string()
        .optional()
        .describe('Optional verification command for mode=run'),
      timeout_ms: z.number().optional().describe('Command timeout for mode=run'),
      working_directory: z
        .string()
        .optional()
        .describe('Optional command working directory for mode=run'),
      session_id: z.string().optional().describe('Target session id'),
      max_cycles: z.number().optional().describe('Max autopilot cycles for the window'),
      auto_continue: z.boolean().optional().describe('Whether loops auto-continue'),
      strict_quality_gate: z
        .boolean()
        .optional()
        .describe('Enable strict quality gate before completion'),
    },
    async execute(args, ctx) {
      const sessionID =
        args.session_id && String(args.session_id).trim().length > 0
          ? String(args.session_id)
          : getSessionID(ctx);
      const mode = String(args.mode);

      if (mode === 'status') {
        const state = getSessionState(projectDir, sessionID);
        return [
          `session=${sessionID}`,
          `loop_enabled=${state.loopEnabled}`,
          `auto_continue=${state.autoContinue}`,
          `max_cycles=${state.maxIterationsPerWindow}`,
          `strict_quality_gate=${state.strictQualityGate}`,
          `iteration_completed=${state.iterationCompleted}`,
        ].join('\n');
      }

      if (mode === 'stop') {
        const state = configureAutopilotSession({
          projectDir,
          sessionID,
          enabled: false,
        });
        return [
          `session=${sessionID}`,
          'autopilot=stopped',
          `loop_enabled=${state.loopEnabled}`,
        ].join('\n');
      }

      const goal = String(args.goal ?? '').trim();
      if (mode === 'run') {
        const execution = runAutopilot({
          goal: goal || 'autopilot run',
          commands: Array.isArray(args.commands) ? args.commands.map(String) : [],
          verificationCommand: args.verification_command
            ? String(args.verification_command)
            : undefined,
          timeoutMs: typeof args.timeout_ms === 'number' ? Number(args.timeout_ms) : 60000,
          workingDirectory: args.working_directory
            ? String(args.working_directory)
            : undefined,
        });
        const lines = [
          `session=${sessionID}`,
          `autopilot_run_success=${execution.success}`,
          `execution_steps=${execution.execution.length}`,
          `summary=${execution.summary}`,
          summarizeAutopilotPlan(execution.plan),
          summarizeVerification(execution.verification),
        ];
        const last = execution.execution.slice(-4);
        if (last.length > 0) {
          lines.push('recent_execution=');
          for (const item of last) {
            lines.push(
              `- ok=${item.ok} exit=${item.exitCode} duration_ms=${item.durationMs} cmd=${item.command}`,
            );
          }
        }
        return lines.join('\n');
      }

      const plan = createAutopilotPlan(goal || 'autopilot goal');
      const state = configureAutopilotSession({
        projectDir,
        sessionID,
        enabled: true,
        maxCycles:
          typeof args.max_cycles === 'number' ? Number(args.max_cycles) : undefined,
        autoContinue:
          typeof args.auto_continue === 'boolean'
            ? Boolean(args.auto_continue)
            : undefined,
        strictQualityGate:
          typeof args.strict_quality_gate === 'boolean'
            ? Boolean(args.strict_quality_gate)
            : undefined,
      });

      return [
        `session=${sessionID}`,
        'autopilot=started',
        `loop_enabled=${state.loopEnabled}`,
        `auto_continue=${state.autoContinue}`,
        `max_cycles=${state.maxIterationsPerWindow}`,
        `strict_quality_gate=${state.strictQualityGate}`,
        summarizeAutopilotPlan(plan),
      ].join('\n');
    },
  });

  return {
    miya_autopilot,
  };
}
