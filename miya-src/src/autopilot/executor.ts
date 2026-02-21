import { getSessionState, setSessionState } from '../workflow';
import { runProcessSync } from '../utils';
import { attachCommandSteps, createAutopilotPlan } from './planner';
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

  const proc = runProcessSync(shellArgs[0], shellArgs.slice(1), {
    cwd,
    timeout: Math.max(1000, Math.min(timeoutMs, 10 * 60 * 1000)),
  });

  return {
    command,
    ok: proc.exitCode === 0 && !proc.timedOut,
    exitCode: proc.exitCode,
    stdout: proc.stdout,
    stderr: proc.stderr,
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
  const execution: AutopilotCommandResult[] = [];

  for (const command of input.commands) {
    const cmd = String(command).trim();
    if (!cmd) continue;
    const result = runCommand(cmd, input.timeoutMs, input.workingDirectory);
    execution.push(result);
    if (!result.ok) {
      return {
        success: false,
        summary: `Execution failed: ${cmd} (exit=${result.exitCode}).`,
        plan,
        execution,
      };
    }
  }

  if (input.verificationCommand?.trim()) {
    const verification = runCommand(
      input.verificationCommand.trim(),
      input.timeoutMs,
      input.workingDirectory,
    );
    return {
      success: verification.ok,
      summary: verification.ok
        ? 'Execution and verification completed successfully.'
        : `Verification failed (exit=${verification.exitCode}).`,
      plan,
      execution,
      verification,
    };
  }

  return {
    success: true,
    summary: 'Execution completed without explicit verification command.',
    plan,
    execution,
  };
}
