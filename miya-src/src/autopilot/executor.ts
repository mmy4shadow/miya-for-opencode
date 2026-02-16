import { getSessionState, setSessionState } from '../workflow';
import { currentPolicyHash } from '../policy';
import { attachCommandSteps, createAutopilotPlan } from './planner';
import {
  appendPlanBundleAudit,
  createPlanBundleV1,
  markPlanBundleExecution,
  markPlanBundleFinalized,
  markPlanBundleRollback,
  markPlanBundleRunning,
  markPlanBundleVerification,
} from './plan-bundle';
import {
  buildPlanBundleTaskSignature,
  loadReusablePlanTemplate,
  saveReusablePlanTemplate,
} from './plan-reuse';
import { recordAutopilotRunDigest } from './stats';
import type {
  AutopilotCommandResult,
  AutopilotRunInput,
  AutopilotRunResult,
} from './types';

export function configureAutopilotSession(input: {
  projectDir: string;
  sessionID: string;
  maxCycles?: number;
  autoContinue?: boolean;
  strictQualityGate?: boolean;
  enabled: boolean;
}): ReturnType<typeof getSessionState> {
  const state = getSessionState(input.projectDir, input.sessionID);
  state.loopEnabled = input.enabled;
  if (typeof input.maxCycles === 'number') {
    state.maxIterationsPerWindow = Math.max(1, Math.min(20, Math.floor(input.maxCycles)));
  }
  if (typeof input.autoContinue === 'boolean') {
    state.autoContinue = input.autoContinue;
  }
  if (typeof input.strictQualityGate === 'boolean') {
    state.strictQualityGate = input.strictQualityGate;
  }
  setSessionState(input.projectDir, input.sessionID, state);
  return state;
}

function runCommand(
  command: string,
  timeoutMs: number,
  cwd?: string,
): AutopilotCommandResult {
  const start = Date.now();
  const shellArgs =
    process.platform === 'win32'
      ? ['powershell', '-NoProfile', '-Command', command]
      : ['sh', '-lc', command];

  const proc = Bun.spawnSync(shellArgs, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: Math.max(1000, Math.min(timeoutMs, 10 * 60 * 1000)),
  });

  return {
    command,
    ok: proc.exitCode === 0,
    exitCode: proc.exitCode,
    stdout: Buffer.from(proc.stdout).toString('utf-8'),
    stderr: Buffer.from(proc.stderr).toString('utf-8'),
    durationMs: Date.now() - start,
  };
}

function resolveRetryLimit(override?: number): number {
  if (typeof override === 'number') {
    return Math.max(0, Math.min(3, Math.floor(override)));
  }
  const envLimit = Number(process.env.MIYA_AUTOPILOT_MAX_RETRIES ?? 1);
  if (!Number.isFinite(envLimit)) return 1;
  return Math.max(0, Math.min(3, Math.floor(envLimit)));
}

function isRetriableFailure(result: AutopilotCommandResult): boolean {
  if (result.ok) return false;
  if (result.exitCode === 124 || result.exitCode === 137 || result.exitCode === 143) return true;
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return /timeout|temporar|network|rate.?limit|connection|econnreset|eai_again/.test(text);
}

function withAttemptSuffix(result: AutopilotCommandResult, attempt: number): AutopilotCommandResult {
  if (attempt <= 0) return result;
  return {
    ...result,
    command: `${result.command} [retry_${attempt}]`,
  };
}

export function runAutopilot(input: AutopilotRunInput): AutopilotRunResult {
  const maxRetriesPerCommand = resolveRetryLimit(input.maxRetriesPerCommand);
  const resolvedPolicyHash =
    String(input.policyHash ?? '').trim() ||
    (input.projectDir ? currentPolicyHash(input.projectDir) : 'UNSPECIFIED_POLICY_HASH');
  const normalizedInput: AutopilotRunInput = {
    ...input,
    policyHash: resolvedPolicyHash,
    capabilitiesNeeded:
      Array.isArray(input.capabilitiesNeeded) && input.capabilitiesNeeded.length > 0
        ? input.capabilitiesNeeded
        : ['bash'],
    riskTier: input.riskTier ?? 'STANDARD',
    mode: input.mode ?? 'work',
  };
  const signature =
    input.projectDir
      ? buildPlanBundleTaskSignature({
          goal: input.goal,
          commands: input.commands,
          verificationCommand: input.verificationCommand,
          workingDirectory: input.workingDirectory,
          mode: normalizedInput.mode,
          riskTier: normalizedInput.riskTier,
        })
      : undefined;
  const reused =
    input.projectDir && signature
      ? loadReusablePlanTemplate({
          projectDir: input.projectDir,
          signature,
          goal: input.goal,
        })
      : null;
  const basePlan = reused?.plan ?? createAutopilotPlan(input.goal);
  const plan = attachCommandSteps(
    basePlan,
    input.commands,
    input.verificationCommand,
  );
  const bundle = createPlanBundleV1({
    goal: input.goal,
    plan,
    runInput: normalizedInput,
  });
  if (signature && input.projectDir) {
    saveReusablePlanTemplate({
      projectDir: input.projectDir,
      signature,
      plan: basePlan,
      commandCount: input.commands.length,
      verificationEnabled: Boolean(input.verificationCommand?.trim()),
      bundleId: bundle.bundleId,
    });
  }
  if (reused && signature) {
    appendPlanBundleAudit(bundle, {
      stage: 'plan',
      action: 'plan_template_reused',
      inputSummary: {
        signature: signature.slice(0, 16),
        templateId: reused.templateId,
        hits: reused.hits,
      },
      approvalBasis: 'plan_reuse_cache_hit',
      result: {
        reused: true,
      },
    });
  }
  if (bundle.approval.required && !bundle.approval.approved) {
    const summary = 'Execution blocked: approval required before run.';
    markPlanBundleFinalized(bundle, {
      success: false,
      summary,
    });
    const blockedResult: AutopilotRunResult = {
      success: false,
      retryCount: 0,
      summary,
      planBundle: bundle,
      plan,
      execution: [],
      auditLedger: bundle.audit,
    };
    if (input.projectDir) {
      recordAutopilotRunDigest(input.projectDir, {
        at: new Date().toISOString(),
        success: false,
        commandCount: 0,
        retryCount: 0,
        verificationAttempted: false,
        verificationPassed: false,
        rollbackAttempted: false,
        rollbackSucceeded: false,
        failureReason: 'approval_required',
      });
    }
    return blockedResult;
  }
  markPlanBundleRunning(bundle);
  const execution: AutopilotCommandResult[] = [];
  let retryCount = 0;

  const persistDigest = (result: AutopilotRunResult, failureReason?: string): AutopilotRunResult => {
    if (input.projectDir) {
      recordAutopilotRunDigest(input.projectDir, {
        at: new Date().toISOString(),
        success: result.success,
        commandCount: result.execution.length,
        retryCount,
        verificationAttempted: Boolean(result.verification),
        verificationPassed: Boolean(result.verification?.ok),
        rollbackAttempted: Boolean(result.rollback),
        rollbackSucceeded: Boolean(result.rollback?.ok),
        failureReason: failureReason?.slice(0, 200),
      });
    }
    return result;
  };

  for (const command of input.commands) {
    const cmd = String(command).trim();
    if (!cmd) continue;
    let attempt = 0;
    let finalResult: AutopilotCommandResult | undefined;
    while (attempt <= maxRetriesPerCommand) {
      const result = withAttemptSuffix(
        runCommand(cmd, input.timeoutMs, input.workingDirectory),
        attempt,
      );
      execution.push(result);
      markPlanBundleExecution(bundle, result);
      finalResult = result;
      if (result.ok) break;
      if (attempt >= maxRetriesPerCommand || !isRetriableFailure(result)) break;
      retryCount += 1;
      appendPlanBundleAudit(bundle, {
        stage: 'execution',
        action: 'command_retry_scheduled',
        inputSummary: {
          command: cmd,
          nextAttempt: attempt + 1,
          maxRetriesPerCommand,
          exitCode: result.exitCode,
        },
        approvalBasis: bundle.approval.approved ? 'approved' : 'not_required',
        result: {
          retriable: true,
        },
      });
      attempt += 1;
    }
    if (!finalResult?.ok) {
      const rollbackCommand = input.rollbackCommand?.trim();
      let rollbackResult: AutopilotCommandResult | undefined;
      if (rollbackCommand) {
        rollbackResult = runCommand(rollbackCommand, input.timeoutMs, input.workingDirectory);
      }
      markPlanBundleRollback(
        bundle,
        rollbackResult,
        `execution_failed:${cmd}:exit=${finalResult?.exitCode ?? -1}`,
      );
      const summary = rollbackResult
        ? rollbackResult.ok
          ? `Execution failed and rollback completed: ${cmd} (exit=${finalResult?.exitCode ?? -1}).`
          : `Execution failed and rollback failed: ${cmd} (exit=${finalResult?.exitCode ?? -1}).`
        : `Execution failed: ${cmd} (exit=${finalResult?.exitCode ?? -1}).`;
      markPlanBundleFinalized(bundle, {
        success: false,
        summary,
      });
      return persistDigest({
        success: false,
        retryCount,
        summary,
        planBundle: bundle,
        plan,
        execution,
        rollback: rollbackResult,
        auditLedger: bundle.audit,
      }, finalResult?.stderr || finalResult?.command || 'execution_failed');
    }
  }

  if (input.verificationCommand?.trim()) {
    let attempt = 0;
    let verification = runCommand(
      input.verificationCommand.trim(),
      input.timeoutMs,
      input.workingDirectory,
    );
    markPlanBundleVerification(bundle, withAttemptSuffix(verification, attempt));
    while (!verification.ok && attempt < maxRetriesPerCommand && isRetriableFailure(verification)) {
      retryCount += 1;
      attempt += 1;
      appendPlanBundleAudit(bundle, {
        stage: 'execution',
        action: 'verification_retry_scheduled',
        inputSummary: {
          command: input.verificationCommand.trim(),
          nextAttempt: attempt,
          maxRetriesPerCommand,
          exitCode: verification.exitCode,
        },
        approvalBasis: bundle.approval.approved ? 'approved' : 'not_required',
        result: {
          retriable: true,
        },
      });
      verification = runCommand(
        input.verificationCommand.trim(),
        input.timeoutMs,
        input.workingDirectory,
      );
      markPlanBundleVerification(bundle, withAttemptSuffix(verification, attempt));
    }
    if (!verification.ok && input.rollbackCommand?.trim()) {
      const rollback = runCommand(
        input.rollbackCommand.trim(),
        input.timeoutMs,
        input.workingDirectory,
      );
      markPlanBundleRollback(bundle, rollback, `verification_failed:exit=${verification.exitCode}`);
      const summary = rollback.ok
        ? `Verification failed (exit=${verification.exitCode}); rollback completed.`
        : `Verification failed (exit=${verification.exitCode}); rollback failed.`;
      markPlanBundleFinalized(bundle, {
        success: false,
        summary,
      });
      return persistDigest({
        success: false,
        retryCount,
        summary,
        planBundle: bundle,
        plan,
        execution,
        verification,
        rollback,
        auditLedger: bundle.audit,
      }, verification.stderr || 'verification_failed');
    }
    const summary = verification.ok
      ? 'Execution and verification completed successfully.'
      : `Verification failed (exit=${verification.exitCode}).`;
    markPlanBundleFinalized(bundle, {
      success: verification.ok,
      summary,
    });
    return persistDigest({
      success: verification.ok,
      retryCount,
      summary,
      planBundle: bundle,
      plan,
      execution,
      verification,
      auditLedger: bundle.audit,
    }, verification.ok ? undefined : verification.stderr || 'verification_failed');
  }

  markPlanBundleFinalized(bundle, {
    success: true,
    summary: 'Execution completed without explicit verification command.',
  });
  return persistDigest({
    success: true,
    retryCount,
    summary: 'Execution completed without explicit verification command.',
    planBundle: bundle,
    plan,
    execution,
    auditLedger: bundle.audit,
  });
}
