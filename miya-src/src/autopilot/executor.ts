import { getSessionState, setSessionState } from '../workflow';
import { attachCommandSteps, createAutopilotPlan } from './planner';
import {
  createPlanBundleV1,
  markPlanBundleExecution,
  markPlanBundleFinalized,
  markPlanBundleRollback,
  markPlanBundleRunning,
  markPlanBundleVerification,
} from './plan-bundle';
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

export function runAutopilot(input: AutopilotRunInput): AutopilotRunResult {
  const basePlan = createAutopilotPlan(input.goal);
  const plan = attachCommandSteps(
    basePlan,
    input.commands,
    input.verificationCommand,
  );
  const bundle = createPlanBundleV1({
    goal: input.goal,
    plan,
    runInput: input,
  });
  if (bundle.approval.required && !bundle.approval.approved) {
    const summary = 'Execution blocked: approval required before run.';
    markPlanBundleFinalized(bundle, {
      success: false,
      summary,
    });
    return {
      success: false,
      summary,
      planBundle: bundle,
      plan,
      execution: [],
      auditLedger: bundle.audit,
    };
  }
  markPlanBundleRunning(bundle);
  const execution: AutopilotCommandResult[] = [];

  for (const command of input.commands) {
    const cmd = String(command).trim();
    if (!cmd) continue;
    const result = runCommand(cmd, input.timeoutMs, input.workingDirectory);
    execution.push(result);
    markPlanBundleExecution(bundle, result);
    if (!result.ok) {
      const rollbackCommand = input.rollbackCommand?.trim();
      let rollbackResult: AutopilotCommandResult | undefined;
      if (rollbackCommand) {
        rollbackResult = runCommand(rollbackCommand, input.timeoutMs, input.workingDirectory);
      }
      markPlanBundleRollback(
        bundle,
        rollbackResult,
        `execution_failed:${cmd}:exit=${result.exitCode}`,
      );
      const summary = rollbackResult
        ? rollbackResult.ok
          ? `Execution failed and rollback completed: ${cmd} (exit=${result.exitCode}).`
          : `Execution failed and rollback failed: ${cmd} (exit=${result.exitCode}).`
        : `Execution failed: ${cmd} (exit=${result.exitCode}).`;
      markPlanBundleFinalized(bundle, {
        success: false,
        summary,
      });
      return {
        success: false,
        summary,
        planBundle: bundle,
        plan,
        execution,
        rollback: rollbackResult,
        auditLedger: bundle.audit,
      };
    }
  }

  if (input.verificationCommand?.trim()) {
    const verification = runCommand(
      input.verificationCommand.trim(),
      input.timeoutMs,
      input.workingDirectory,
    );
    markPlanBundleVerification(bundle, verification);
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
      return {
        success: false,
        summary,
        planBundle: bundle,
        plan,
        execution,
        verification,
        rollback,
        auditLedger: bundle.audit,
      };
    }
    const summary = verification.ok
      ? 'Execution and verification completed successfully.'
      : `Verification failed (exit=${verification.exitCode}).`;
    markPlanBundleFinalized(bundle, {
      success: verification.ok,
      summary,
    });
    return {
      success: verification.ok,
      summary,
      planBundle: bundle,
      plan,
      execution,
      verification,
      auditLedger: bundle.audit,
    };
  }

  markPlanBundleFinalized(bundle, {
    success: true,
    summary: 'Execution completed without explicit verification command.',
  });
  return {
    success: true,
    summary: 'Execution completed without explicit verification command.',
    planBundle: bundle,
    plan,
    execution,
    auditLedger: bundle.audit,
  };
}
