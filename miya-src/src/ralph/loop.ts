import { analyzeFailure } from './error-analyzer';
import type {
  RalphAttempt,
  RalphCommandResult,
  RalphLoopInput,
  RalphLoopResult,
} from './types';

function runCommand(
  command: string,
  timeoutMs: number,
  cwd?: string,
): RalphCommandResult {
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

function pushAttempt(
  attempts: RalphAttempt[],
  iteration: number,
  type: 'task' | 'verify' | 'fix',
  result: RalphCommandResult,
): void {
  attempts.push({ iteration, type, result });
}

export function executeRalphLoop(input: RalphLoopInput): RalphLoopResult {
  const attempts: RalphAttempt[] = [];
  const maxIterations = Math.max(1, Math.min(input.maxIterations, 20));
  const fixQueue = [...(input.fixCommands ?? [])];
  let taskRan = false;
  let finalVerification: RalphCommandResult | undefined;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (!taskRan && input.taskCommand) {
      const taskResult = runCommand(
        input.taskCommand,
        input.timeoutMs,
        input.workingDirectory,
      );
      pushAttempt(attempts, iteration, 'task', taskResult);
      taskRan = true;
    }

    const verifyResult = runCommand(
      input.verificationCommand,
      input.timeoutMs,
      input.workingDirectory,
    );
    finalVerification = verifyResult;
    pushAttempt(attempts, iteration, 'verify', verifyResult);

    if (verifyResult.ok) {
      return {
        success: true,
        iterations: iteration,
        attempts,
        summary: `Verification passed at iteration ${iteration}.`,
        finalVerification,
      };
    }

    const failure = analyzeFailure(`${verifyResult.stdout}\n${verifyResult.stderr}`);
    const verifyAttempt = attempts[attempts.length - 1];
    verifyAttempt.failureKind = failure.kind;
    verifyAttempt.failureSummary = failure.summary;

    const nextFix = fixQueue.shift();
    if (!nextFix) {
      return {
        success: false,
        iterations: iteration,
        attempts,
        summary: `Verification failed and no fix command remained. Last issue: ${failure.summary}`,
        finalVerification,
      };
    }

    const fixResult = runCommand(nextFix, input.timeoutMs, input.workingDirectory);
    pushAttempt(attempts, iteration, 'fix', fixResult);
  }

  return {
    success: false,
    iterations: maxIterations,
    attempts,
    summary: 'Verification did not pass before reaching max iterations.',
    finalVerification,
  };
}

