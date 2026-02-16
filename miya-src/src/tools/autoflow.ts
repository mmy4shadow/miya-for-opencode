import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
import {
  configureAutoflowSession,
  getAutoflowSession,
  getAutoflowPersistentRuntimeSnapshot,
  readAutoflowPersistentConfig,
  runAutoflow,
  stopAutoflowSession,
  writeAutoflowPersistentConfig,
} from '../autoflow';
import {
  clearPlanBundleBinding,
  preparePlanBundleBinding,
  readPlanBundleBinding,
  updatePlanBundleBindingStatus,
} from '../autopilot';
import { currentPolicyHash } from '../policy';

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

function formatPersistentSummary(projectDir: string, sessionID: string): string[] {
  const config = readAutoflowPersistentConfig(projectDir);
  const runtime = getAutoflowPersistentRuntimeSnapshot(projectDir, 200).find(
    (item) => item.sessionID === sessionID,
  );
  return [
    `persistent_enabled=${config.enabled}`,
    `persistent_resume_cooldown_ms=${config.resumeCooldownMs}`,
    `persistent_max_auto_resumes=${config.maxAutoResumes}`,
    `persistent_max_resume_failures=${config.maxConsecutiveResumeFailures}`,
    `persistent_resume_timeout_ms=${config.resumeTimeoutMs}`,
    `persistent_resume_attempts=${runtime?.resumeAttempts ?? 0}`,
    `persistent_resume_failures=${runtime?.resumeFailures ?? 0}`,
    `persistent_user_stopped=${runtime?.userStopped ?? false}`,
    `persistent_last_outcome_phase=${runtime?.lastOutcomePhase ?? '(none)'}`,
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
      plan_bundle_id: z
        .string()
        .optional()
        .describe('PlanBundle id. Auto-generated if omitted.'),
      policy_hash: z
        .string()
        .optional()
        .describe('Policy hash for this autonomous run.'),
      risk_tier: z
        .enum(['LIGHT', 'STANDARD', 'THOROUGH'])
        .optional()
        .describe('Risk tier for this autonomous execution bundle'),
      force_restart: z
        .boolean()
        .optional()
        .describe('Reset finished/failed state and rerun from planning'),
      persistent_enabled: z
        .boolean()
        .optional()
        .describe('Enable/disable non-user stop auto resume'),
      persistent_resume_cooldown_ms: z.number().optional(),
      persistent_max_auto_resumes: z.number().optional(),
      persistent_max_resume_failures: z.number().optional(),
      persistent_resume_timeout_ms: z.number().optional(),
    },
    async execute(args, ctx) {
      const sessionID =
        typeof args.session_id === 'string' && args.session_id.trim().length > 0
          ? args.session_id.trim()
          : getSessionID(ctx);
      const mode = String(args.mode ?? 'run');

      if (mode === 'status') {
        const state = getAutoflowSession(projectDir, sessionID);
        return [...formatStateSummary(state), ...formatPersistentSummary(projectDir, sessionID)].join(
          '\n',
        );
      }

      if (mode === 'stop') {
        clearPlanBundleBinding(projectDir, sessionID);
        const state = stopAutoflowSession(projectDir, sessionID);
        return [...formatStateSummary(state), 'autoflow=stopped'].join('\n');
      }

      if (
        typeof args.persistent_enabled === 'boolean' ||
        typeof args.persistent_resume_cooldown_ms === 'number' ||
        typeof args.persistent_max_auto_resumes === 'number' ||
        typeof args.persistent_max_resume_failures === 'number' ||
        typeof args.persistent_resume_timeout_ms === 'number'
      ) {
        writeAutoflowPersistentConfig(projectDir, {
          enabled:
            typeof args.persistent_enabled === 'boolean'
              ? Boolean(args.persistent_enabled)
              : undefined,
          resumeCooldownMs:
            typeof args.persistent_resume_cooldown_ms === 'number'
              ? Number(args.persistent_resume_cooldown_ms)
              : undefined,
          maxAutoResumes:
            typeof args.persistent_max_auto_resumes === 'number'
              ? Number(args.persistent_max_auto_resumes)
              : undefined,
          maxConsecutiveResumeFailures:
            typeof args.persistent_max_resume_failures === 'number'
              ? Number(args.persistent_max_resume_failures)
              : undefined,
          resumeTimeoutMs:
            typeof args.persistent_resume_timeout_ms === 'number'
              ? Number(args.persistent_resume_timeout_ms)
              : undefined,
        });
      }

      if (mode === 'start') {
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
          sourceTool: 'miya_autoflow',
          mode: 'work',
          riskTier,
          policyHash,
        });
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
        return [
          ...formatStateSummary(state),
          `plan_bundle_id=${planBundleID}`,
          `policy_hash=${policyHash}`,
          `risk_tier=${riskTier}`,
          ...formatPersistentSummary(projectDir, sessionID),
          'autoflow=configured',
        ].join('\n');
      }

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
        sourceTool: 'miya_autoflow',
        mode: 'work',
        riskTier,
        policyHash,
      });
      updatePlanBundleBindingStatus(projectDir, {
        sessionID,
        bundleId: planBundleID,
        status: 'running',
      });
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
      updatePlanBundleBindingStatus(projectDir, {
        sessionID,
        bundleId: planBundleID,
        status: result.success ? 'completed' : 'failed',
      });

      const lines = [
        `plan_bundle_id=${planBundleID}`,
        `policy_hash=${policyHash}`,
        `risk_tier=${riskTier}`,
        `autoflow_success=${result.success}`,
        `summary=${result.summary}`,
        ...formatStateSummary(result.state),
        ...formatPersistentSummary(projectDir, sessionID),
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
