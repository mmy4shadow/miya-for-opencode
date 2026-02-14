import { createHash } from 'node:crypto';
import { analyzeFailure } from './error-analyzer';
import type {
  RalphAttempt,
  RalphCommandResult,
  RalphLoopInput,
  RalphLoopResult,
} from './types';

function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;

  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const temp = dp[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function similarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(left, right) / maxLen;
}

function parseChangedLineKeys(diffText: string): string[] {
  const keys: string[] = [];
  const lines = diffText.split(/\r?\n/);
  let currentFile = '';

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length);
      continue;
    }
    if (!line.startsWith('@@') || !currentFile) continue;
    const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = Number(match[2] ?? '1');
    const end = start + Math.max(1, count) - 1;
    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      keys.push(`${currentFile}:${lineNumber}`);
    }
  }
  return keys;
}

function defaultReadDiff(cwd?: string): string {
  const proc = Bun.spawnSync(['git', 'diff', '--unified=0'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (proc.exitCode !== 0) return '';
  return Buffer.from(proc.stdout).toString('utf-8');
}

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

function renderFixCommand(
  template: string,
  input: {
    iteration: number;
    failureSummary: string;
    stderr: string;
    stdout: string;
  },
): string {
  const stderrTrimmed = input.stderr.trim();
  const stdoutTrimmed = input.stdout.trim();
  return template
    .replaceAll('{{ITERATION}}', String(input.iteration))
    .replaceAll('{{FAILURE_SUMMARY}}', input.failureSummary)
    .replaceAll('{{LAST_STDERR}}', stderrTrimmed)
    .replaceAll('{{LAST_STDOUT}}', stdoutTrimmed)
    .replaceAll('{{LAST_ERROR}}', stderrTrimmed || stdoutTrimmed || input.failureSummary);
}

function pushAttempt(
  attempts: RalphAttempt[],
  iteration: number,
  type: 'task' | 'verify' | 'fix',
  result: RalphCommandResult,
): RalphAttempt {
  const attempt: RalphAttempt = { iteration, type, result };
  attempts.push(attempt);
  return attempt;
}

export function executeRalphLoop(input: RalphLoopInput): RalphLoopResult {
  const attempts: RalphAttempt[] = [];
  const maxIterations = Math.max(1, Math.min(input.maxIterations, 30));
  const budgetMs = Math.max(2000, Math.min(input.budgetMs ?? 5 * 60 * 1000, 30 * 60 * 1000));
  const stallWindow = Math.max(2, Math.min(input.stallWindow ?? 3, 10));
  const errorSimilarityThreshold = Math.max(
    0.5,
    Math.min(input.errorSimilarityThreshold ?? 0.9, 1),
  );
  const sameLineTouchLimit = Math.max(2, Math.min(input.sameLineTouchLimit ?? 5, 30));

  const run = input.runCommand ?? runCommand;
  const readDiff = input.readDiff ?? defaultReadDiff;
  const fixQueue = [...(input.fixCommands ?? [])];
  const lineTouchCounts = new Map<string, number>();
  const fingerprints = new Set<string>();
  const recentVerifyAttempts: RalphAttempt[] = [];
  const startedAt = Date.now();

  let taskRan = false;
  let finalVerification: RalphCommandResult | undefined;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (Date.now() - startedAt > budgetMs) {
      return {
        success: false,
        iterations: iteration - 1,
        attempts,
        summary: `Loop stopped because time budget was exceeded (${budgetMs} ms).`,
        finalVerification,
        reason: 'budget_exceeded',
      };
    }

    if (!taskRan && input.taskCommand) {
      const taskResult = run(input.taskCommand, input.timeoutMs, input.workingDirectory);
      pushAttempt(attempts, iteration, 'task', taskResult);
      taskRan = true;
    }

    const verifyResult = run(
      input.verificationCommand,
      input.timeoutMs,
      input.workingDirectory,
    );
    finalVerification = verifyResult;
    const verifyAttempt = pushAttempt(attempts, iteration, 'verify', verifyResult);

    if (verifyResult.ok) {
      return {
        success: true,
        iterations: iteration,
        attempts,
        summary: `Verification passed at iteration ${iteration}.`,
        finalVerification,
        reason: 'verified',
      };
    }

    const failure = analyzeFailure(`${verifyResult.stdout}\n${verifyResult.stderr}`);
    verifyAttempt.failureKind = failure.kind;
    verifyAttempt.failureSummary = failure.summary;
    verifyAttempt.stderrHash = hashText(verifyResult.stderr || verifyResult.stdout);

    const diffText = readDiff(input.workingDirectory);
    verifyAttempt.diffHash = hashText(diffText);
    const fingerprint = hashText(
      [
        verifyAttempt.stderrHash,
        verifyAttempt.diffHash,
        failure.kind,
      ].join('|'),
    );
    verifyAttempt.fingerprint = fingerprint;

    if (fingerprints.has(fingerprint)) {
      return {
        success: false,
        iterations: iteration,
        attempts,
        summary: `Loop cycle detected at iteration ${iteration}; fingerprint repeated.`,
        finalVerification,
        reason: 'cycle_detected',
      };
    }
    fingerprints.add(fingerprint);

    const changedLineKeys = parseChangedLineKeys(diffText);
    let maxTouches = 0;
    for (const key of changedLineKeys) {
      const next = (lineTouchCounts.get(key) ?? 0) + 1;
      lineTouchCounts.set(key, next);
      if (next > maxTouches) maxTouches = next;
    }
    if (maxTouches >= sameLineTouchLimit) {
      return {
        success: false,
        iterations: iteration,
        attempts,
        summary: `Loop stopped due to same-line churn (>= ${sameLineTouchLimit}).`,
        finalVerification,
        reason: 'same_line_churn',
      };
    }

    if (recentVerifyAttempts.length > 0) {
      const previous = recentVerifyAttempts[recentVerifyAttempts.length - 1];
      const score = similarity(
        `${previous.result.stdout}\n${previous.result.stderr}`,
        `${verifyResult.stdout}\n${verifyResult.stderr}`,
      );
      verifyAttempt.errorSimilarity = score;
      const noProgress =
        score >= errorSimilarityThreshold &&
        previous.failureKind === verifyAttempt.failureKind &&
        previous.diffHash === verifyAttempt.diffHash;
      verifyAttempt.noProgress = noProgress;
    } else {
      verifyAttempt.errorSimilarity = 0;
      verifyAttempt.noProgress = false;
    }

    recentVerifyAttempts.push(verifyAttempt);
    if (recentVerifyAttempts.length > stallWindow) {
      recentVerifyAttempts.shift();
    }

    const stalled =
      recentVerifyAttempts.length >= stallWindow &&
      recentVerifyAttempts.every((attempt) => attempt.noProgress);
    if (stalled) {
      return {
        success: false,
        iterations: iteration,
        attempts,
        summary: `Loop stalled: ${stallWindow} consecutive no-progress iterations.`,
        finalVerification,
        reason: 'no_progress',
      };
    }

    const nextFixTemplate = fixQueue.shift();
    const nextFix = nextFixTemplate
      ? renderFixCommand(nextFixTemplate, {
          iteration,
          failureSummary: failure.summary,
          stderr: verifyResult.stderr,
          stdout: verifyResult.stdout,
        })
      : '';
    if (!nextFix) {
      return {
        success: false,
        iterations: iteration,
        attempts,
        summary: `Verification failed and no fix command remained. Last issue: ${failure.summary}`,
        finalVerification,
        reason: 'no_fix_command',
      };
    }

    const fixResult = run(nextFix, input.timeoutMs, input.workingDirectory);
    pushAttempt(attempts, iteration, 'fix', fixResult);
  }

  return {
    success: false,
    iterations: maxIterations,
    attempts,
    summary: 'Verification did not pass before reaching max iterations.',
    finalVerification,
    reason: 'max_iterations_reached',
  };
}
