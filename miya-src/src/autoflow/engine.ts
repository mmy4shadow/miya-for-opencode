import { createHash } from 'node:crypto';
import { runUltraworkDag } from '../ultrawork/scheduler';
import {
  appendAutoflowHistory,
  configureAutoflowSession,
  getAutoflowSession,
  saveAutoflowSession,
} from './state';
import type {
  AutoflowCommandResult,
  AutoflowFailureSummary,
  AutoflowFixability,
  AutoflowPhase,
  AutoflowPipelineSnapshot,
  AutoflowRunInput,
  AutoflowRunResult,
  AutoflowSessionState,
} from './types';

const DEFAULT_TIMEOUT_MS = 90_000;
const RUN_LOOP_LIMIT = 40;

function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function runShellCommand(
  command: string,
  timeoutMs: number,
  cwd?: string,
): AutoflowCommandResult {
  const startedAt = Date.now();
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
    durationMs: Date.now() - startedAt,
  };
}

function normalizeTasks(
  input: AutoflowRunInput['tasks'],
): AutoflowSessionState['planTasks'] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((task) => task && task.agent?.trim() && task.prompt?.trim())
    .map((task, index) => ({
      id: task.id?.trim() || `task_${index + 1}`,
      agent: task.agent.trim(),
      prompt: task.prompt.trim(),
      description: task.description?.trim() || task.prompt.trim().slice(0, 120),
      dependsOn: Array.isArray(task.dependsOn)
        ? task.dependsOn
            .map(String)
            .map((dep) => dep.trim())
            .filter(Boolean)
        : [],
      timeoutMs:
        typeof task.timeoutMs === 'number' && Number.isFinite(task.timeoutMs)
          ? Number(task.timeoutMs)
          : undefined,
      maxRetries:
        typeof task.maxRetries === 'number' && Number.isFinite(task.maxRetries)
          ? Number(task.maxRetries)
          : undefined,
    }));
}

function normalizeFixCommands(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

function setFailed(state: AutoflowSessionState, reason: string): void {
  state.phase = 'failed';
  state.lastError = reason;
  appendAutoflowHistory(state, 'failed', reason);
}

function setCompleted(state: AutoflowSessionState, reason: string): void {
  state.phase = 'completed';
  state.lastError = undefined;
  appendAutoflowHistory(state, 'completed', reason);
}

function verificationFailureReason(result: AutoflowCommandResult): string {
  const text = result.stderr.trim() || result.stdout.trim();
  return text.slice(0, 220) || `verification_exit=${result.exitCode}`;
}

function phaseToStage(phase: AutoflowPhase): AutoflowPipelineSnapshot['stage'] {
  if (phase === 'planning') return 'plan';
  if (phase === 'execution') return 'exec';
  if (phase === 'verification') return 'verify';
  if (phase === 'fixing') return 'fix';
  return 'terminal';
}

function inferFixability(reason: string): AutoflowFixability {
  const text = String(reason ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (/invalid_|schema|syntax|parse|bad_request/.test(text)) return 'rewrite';
  if (/missing_evidence|approval|permission|forbidden|denied/.test(text))
    return 'need_evidence';
  if (/timeout|temporar|network|rate_limit|overload/.test(text))
    return 'retry_later';
  if (/budget|scope|too_long/.test(text)) return 'reduce_scope';
  if (/kill_switch|policy_|impossible|unsupported/.test(text))
    return 'impossible';
  return 'unknown';
}

function buildFailureSummary(
  state: AutoflowSessionState,
  reason: string,
): AutoflowFailureSummary {
  return {
    phase: state.phase,
    stage: phaseToStage(state.phase),
    reason,
    fixability: inferFixability(reason),
    budget: {
      maxFixRounds: state.maxFixRounds,
      usedFixRounds: state.fixRound,
      remainingFixRounds: Math.max(0, state.maxFixRounds - state.fixRound),
      fixCommandsTotal: state.fixCommands.length,
    },
  };
}

function buildPipelineSnapshot(
  state: AutoflowSessionState,
): AutoflowPipelineSnapshot {
  return {
    graph: 'plan->exec->verify->fix',
    phase: state.phase,
    stage: phaseToStage(state.phase),
  };
}

export async function runAutoflow(
  input: AutoflowRunInput,
): Promise<AutoflowRunResult> {
  const timeoutMs =
    typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
      ? Math.max(1000, Math.floor(input.timeoutMs))
      : DEFAULT_TIMEOUT_MS;
  const runCommand = input.runCommand ?? runShellCommand;
  const runDag = input.runDag ?? runUltraworkDag;

  if (input.forceRestart) {
    configureAutoflowSession(input.projectDir, {
      sessionID: input.sessionID,
      goal: input.goal,
      tasks: normalizeTasks(input.tasks),
      verificationCommand: input.verificationCommand,
      fixCommands: normalizeFixCommands(input.fixCommands),
      maxFixRounds: input.maxFixRounds,
      phase: 'planning',
    });
  }

  let state = getAutoflowSession(input.projectDir, input.sessionID);
  if (input.goal?.trim()) state.goal = input.goal.trim();
  if (input.tasks) state.planTasks = normalizeTasks(input.tasks);
  if (input.verificationCommand !== undefined) {
    const command = String(input.verificationCommand).trim();
    state.verificationCommand = command || undefined;
  }
  if (input.fixCommands) {
    state.fixCommands = normalizeFixCommands(input.fixCommands);
  }
  if (
    typeof input.maxFixRounds === 'number' &&
    Number.isFinite(input.maxFixRounds)
  ) {
    state.maxFixRounds = Math.max(
      1,
      Math.min(10, Math.floor(input.maxFixRounds)),
    );
  }

  if (state.phase === 'stopped') {
    state = saveAutoflowSession(input.projectDir, state);
    return {
      success: false,
      phase: state.phase,
      summary: 'autoflow_stopped',
      pipeline: buildPipelineSnapshot(state),
      state,
      failure: buildFailureSummary(state, 'autoflow_stopped'),
    };
  }

  if (state.phase === 'completed' || state.phase === 'failed') {
    if (input.forceRestart) {
      state.phase = 'planning';
      state.fixRound = 0;
      state.recentVerificationHashes = [];
      state.lastError = undefined;
      appendAutoflowHistory(state, 'restarted', 'State reset for new run.');
    } else {
      state = saveAutoflowSession(input.projectDir, state);
      return {
        success: state.phase === 'completed',
        phase: state.phase,
        summary: `autoflow_${state.phase}`,
        pipeline: buildPipelineSnapshot(state),
        state,
        failure:
          state.phase === 'failed'
            ? buildFailureSummary(state, state.lastError ?? 'autoflow_failed')
            : undefined,
      };
    }
  }

  let dagResult: AutoflowRunResult['dagResult'];
  let verification: AutoflowRunResult['verification'];
  let fixResult: AutoflowRunResult['fixResult'];

  for (let loop = 0; loop < RUN_LOOP_LIMIT; loop += 1) {
    if (state.phase === 'planning') {
      if (state.planTasks.length === 0) {
        appendAutoflowHistory(
          state,
          'planning_waiting',
          'No executable tasks in plan.',
        );
        state = saveAutoflowSession(input.projectDir, state);
        return {
          success: false,
          phase: state.phase,
          summary: 'planning_requires_tasks',
          pipeline: buildPipelineSnapshot(state),
          state,
          failure: buildFailureSummary(state, 'planning_requires_tasks'),
        };
      }
      state.phase = 'execution';
      appendAutoflowHistory(
        state,
        'planning_complete',
        `Plan accepted with ${state.planTasks.length} task(s).`,
      );
      continue;
    }

    if (state.phase === 'execution') {
      try {
        dagResult = await runDag({
          manager: input.manager,
          parentSessionID: input.sessionID,
          tasks: state.planTasks,
          maxParallel:
            typeof input.maxParallel === 'number' &&
            Number.isFinite(input.maxParallel)
              ? Number(input.maxParallel)
              : undefined,
        });
      } catch (error) {
        setFailed(
          state,
          `execution_exception:${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }

      state.lastDag = {
        total: dagResult.total,
        completed: dagResult.completed,
        failed: dagResult.failed,
        blocked: dagResult.blocked,
      };

      if (dagResult.total === 0) {
        setFailed(state, 'execution_empty_dag');
        break;
      }

      if (dagResult.failed > 0 || dagResult.blocked > 0) {
        const reason = `execution_not_clean failed=${dagResult.failed} blocked=${dagResult.blocked}`;
        if (state.fixCommands.length === 0) {
          setFailed(state, `${reason} (no fix commands configured)`);
          break;
        }
        state.lastError = reason;
        state.phase = 'fixing';
        appendAutoflowHistory(state, 'execution_failed', reason);
        continue;
      }

      state.phase = 'verification';
      appendAutoflowHistory(
        state,
        'execution_complete',
        'Parallel execution completed.',
      );
      continue;
    }

    if (state.phase === 'verification') {
      if (!state.verificationCommand) {
        setCompleted(state, 'verification_skipped_no_command');
        break;
      }

      verification = runCommand(
        state.verificationCommand,
        timeoutMs,
        input.workingDirectory,
      );
      if (verification.ok) {
        setCompleted(state, 'verification_passed');
        break;
      }

      const hash = hashText(`${verification.stderr}\n${verification.stdout}`);
      state.recentVerificationHashes = [
        ...state.recentVerificationHashes,
        hash,
      ].slice(-3);
      const repeatedFailure =
        state.recentVerificationHashes.length >= 3 &&
        state.recentVerificationHashes.every((item) => item === hash);
      const reason = verificationFailureReason(verification);

      if (repeatedFailure) {
        setFailed(state, `verification_repeated_failure:${reason}`);
        break;
      }

      if (state.fixRound >= state.maxFixRounds) {
        setFailed(state, `verification_failed_max_fix_rounds:${reason}`);
        break;
      }

      if (state.fixCommands.length === 0) {
        setFailed(state, `verification_failed_no_fix_commands:${reason}`);
        break;
      }

      state.lastError = reason;
      state.phase = 'fixing';
      appendAutoflowHistory(state, 'verification_failed', reason);
      continue;
    }

    if (state.phase === 'fixing') {
      if (state.fixRound >= state.maxFixRounds) {
        setFailed(state, 'fix_round_limit_reached');
        break;
      }

      const fixCommand = state.fixCommands[state.fixRound];
      if (!fixCommand) {
        setFailed(state, `missing_fix_command_at_round_${state.fixRound + 1}`);
        break;
      }

      fixResult = runCommand(fixCommand, timeoutMs, input.workingDirectory);
      state.fixRound += 1;
      appendAutoflowHistory(
        state,
        'fix_attempt',
        `round=${state.fixRound} ok=${fixResult.ok} exit=${fixResult.exitCode}`,
      );

      state.phase = 'verification';
      continue;
    }

    break;
  }

  state = saveAutoflowSession(input.projectDir, state);
  const success = state.phase === 'completed';
  return {
    success,
    phase: state.phase,
    summary: success
      ? 'autoflow_completed'
      : (state.lastError ?? `autoflow_${state.phase}`),
    pipeline: buildPipelineSnapshot(state),
    state,
    dagResult,
    verification,
    fixResult,
    failure:
      success || state.phase === 'stopped'
        ? undefined
        : buildFailureSummary(
            state,
            state.lastError ?? `autoflow_${state.phase}`,
          ),
  };
}
