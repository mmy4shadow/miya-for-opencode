import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  configureAutopilotSession,
  createAutopilotPlan,
  summarizeAutopilotPlan,
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
        .enum(['start', 'stop', 'status'])
        .default('start')
        .describe('start to enable autopilot, stop to disable, status to inspect'),
      goal: z
        .string()
        .optional()
        .describe('Goal text used to build an execution plan when mode=start'),
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
