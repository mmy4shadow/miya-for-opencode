import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  clearPlanBundleBinding,
  configureAutopilotSession,
  createAutopilotPlan,
  preparePlanBundleBinding,
  readPlanBundleBinding,
  readAutopilotStats,
  runAutopilot,
  summarizeAutopilotPlan,
  summarizeVerification,
  updatePlanBundleBindingStatus,
} from '../autopilot';
import { currentPolicyHash } from '../policy';
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
        .enum(['start', 'stop', 'status', 'run', 'stats'])
        .default('start')
        .describe(
          'start to enable autopilot, stop to disable, status/stats to inspect, run to execute commands end-to-end',
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
      max_retries_per_command: z
        .number()
        .optional()
        .describe('Retry budget for transient command failures in mode=run'),
      plan_bundle_id: z
        .string()
        .optional()
        .describe('PlanBundle id. Required for direct run when no prepared bundle exists.'),
      policy_hash: z
        .string()
        .optional()
        .describe('Policy hash for this autonomous run (required for direct run without prepared bundle).'),
      risk_tier: z
        .enum(['LIGHT', 'STANDARD', 'THOROUGH'])
        .optional()
        .describe('Risk tier for this autonomous execution bundle'),
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
        const stats = readAutopilotStats(projectDir);
        return [
          `session=${sessionID}`,
          `loop_enabled=${state.loopEnabled}`,
          `auto_continue=${state.autoContinue}`,
          `max_cycles=${state.maxIterationsPerWindow}`,
          `strict_quality_gate=${state.strictQualityGate}`,
          `iteration_completed=${state.iterationCompleted}`,
          `total_runs=${stats.totalRuns}`,
          `success_runs=${stats.successRuns}`,
          `failed_runs=${stats.failedRuns}`,
          `retry_total=${stats.totalRetries}`,
          `streak_success=${stats.streakSuccess}`,
          `streak_failure=${stats.streakFailure}`,
        ].join('\n');
      }

      if (mode === 'stats') {
        return JSON.stringify(readAutopilotStats(projectDir), null, 2);
      }

      if (mode === 'stop') {
        clearPlanBundleBinding(projectDir, sessionID);
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
        const existingBinding = readPlanBundleBinding(projectDir, sessionID);
        const providedBundleID =
          typeof args.plan_bundle_id === 'string' ? args.plan_bundle_id.trim() : '';
        const providedPolicyHash =
          typeof args.policy_hash === 'string' ? args.policy_hash.trim() : '';
        const providedRiskTier =
          args.risk_tier === 'LIGHT' || args.risk_tier === 'STANDARD' || args.risk_tier === 'THOROUGH'
            ? args.risk_tier
            : undefined;
        const bindingLocked =
          existingBinding &&
          (existingBinding.status === 'prepared' || existingBinding.status === 'running');
        if (bindingLocked) {
          if (existingBinding.sourceTool !== 'miya_autopilot') {
            throw new Error(
              `plan_bundle_source_mismatch:expected=${existingBinding.sourceTool}:got=miya_autopilot`,
            );
          }
          if (providedBundleID && providedBundleID !== existingBinding.bundleId) {
            throw new Error('plan_bundle_frozen_field_mismatch:bundle_id');
          }
          if (providedPolicyHash && providedPolicyHash !== existingBinding.policyHash) {
            throw new Error('plan_bundle_frozen_field_mismatch:policy_hash');
          }
          if (providedRiskTier && providedRiskTier !== existingBinding.riskTier) {
            throw new Error('plan_bundle_frozen_field_mismatch:risk_tier');
          }
        }
        const planBundleID = providedBundleID || existingBinding?.bundleId || '';
        const policyHash = providedPolicyHash || existingBinding?.policyHash || '';
        if (!planBundleID || !policyHash) {
          throw new Error(
            'plan_bundle_required:autopilot_run_requires_plan_bundle_id_and_policy_hash',
          );
        }
        const riskTier =
          providedRiskTier || existingBinding?.riskTier || 'THOROUGH';
        preparePlanBundleBinding(projectDir, {
          sessionID,
          bundleId: planBundleID,
          sourceTool: 'miya_autopilot',
          mode: 'work',
          riskTier,
          policyHash,
        });
        updatePlanBundleBindingStatus(projectDir, {
          sessionID,
          bundleId: planBundleID,
          status: 'running',
        });
        const execution = runAutopilot({
          projectDir,
          sessionID,
          goal: goal || 'autopilot run',
          commands: Array.isArray(args.commands) ? args.commands.map(String) : [],
          verificationCommand: args.verification_command
            ? String(args.verification_command)
            : undefined,
          timeoutMs: typeof args.timeout_ms === 'number' ? Number(args.timeout_ms) : 60000,
          maxRetriesPerCommand:
            typeof args.max_retries_per_command === 'number'
              ? Number(args.max_retries_per_command)
              : undefined,
          mode: 'work',
          riskTier,
          policyHash,
          planBundleID: planBundleID,
          capabilitiesNeeded: ['bash'],
          workingDirectory: args.working_directory
            ? String(args.working_directory)
            : undefined,
        });
        updatePlanBundleBindingStatus(projectDir, {
          sessionID,
          bundleId: planBundleID,
          status: execution.success ? 'completed' : 'failed',
        });
        const lines = [
          `session=${sessionID}`,
          `plan_bundle_id=${planBundleID}`,
          `policy_hash=${policyHash}`,
          `risk_tier=${riskTier}`,
          `autopilot_run_success=${execution.success}`,
          `execution_steps=${execution.execution.length}`,
          `retry_count=${execution.retryCount}`,
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
      const existingBinding = readPlanBundleBinding(projectDir, sessionID);
      const planBundleID =
        (typeof args.plan_bundle_id === 'string' && args.plan_bundle_id.trim()) ||
        existingBinding?.bundleId ||
        `pb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const policyHash =
        (typeof args.policy_hash === 'string' && args.policy_hash.trim()) ||
        existingBinding?.policyHash ||
        currentPolicyHash(projectDir);
      const riskTier =
        args.risk_tier === 'LIGHT' || args.risk_tier === 'STANDARD' || args.risk_tier === 'THOROUGH'
          ? args.risk_tier
          : existingBinding?.riskTier || 'THOROUGH';
      preparePlanBundleBinding(projectDir, {
        sessionID,
        bundleId: planBundleID,
        sourceTool: 'miya_autopilot',
        mode: 'work',
        riskTier,
        policyHash,
      });
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
        `plan_bundle_id=${planBundleID}`,
        `policy_hash=${policyHash}`,
        `risk_tier=${riskTier}`,
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
