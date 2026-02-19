import { spawn } from 'node:child_process';
import * as path from 'node:path';
import {
  appendHistoryRecord,
  createApproval,
  createHistoryId,
  createJobId,
  readAutomationState,
  readHistoryRecords,
  removeHistoryRecord,
  touchJob,
  writeAutomationState,
} from './store';
import type {
  MiyaApprovalRequest,
  MiyaAutomationState,
  MiyaJob,
  MiyaJobHistoryRecord,
  MiyaJobRunResult,
} from './types';

const SCHEDULER_INTERVAL_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const MIN_COMMAND_TIMEOUT_MS = 1_000;
const MAX_COMMAND_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function parseDailyTime(time: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function computeNextDailyRun(time: string, from: Date = new Date()): string {
  const parsed = parseDailyTime(time);
  if (!parsed) {
    throw new Error(`Invalid daily time format: ${time}. Expected HH:mm`);
  }

  const next = new Date(from);
  next.setHours(parsed.hour, parsed.minute, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

function truncateOutput(text: string, maxLength = 20_000): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...[truncated]`;
}

function normalizeCommandText(command: string): string {
  return String(command ?? '').trim();
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  const raw =
    typeof timeoutMs === 'number' ? timeoutMs : DEFAULT_COMMAND_TIMEOUT_MS;
  if (!Number.isFinite(raw)) return DEFAULT_COMMAND_TIMEOUT_MS;
  return Math.max(
    MIN_COMMAND_TIMEOUT_MS,
    Math.min(MAX_COMMAND_TIMEOUT_MS, Math.floor(raw)),
  );
}

function isSubPath(parentDir: string, targetDir: string): boolean {
  const rel = path.relative(parentDir, targetDir);
  if (!rel) return true;
  if (rel.startsWith('..')) return false;
  return !path.isAbsolute(rel);
}

function resolveAndValidateCwd(
  projectDir: string,
  cwd: string | undefined,
): { cwd: string; wasSanitized: boolean } {
  if (!cwd || cwd.trim().length === 0) {
    return { cwd: projectDir, wasSanitized: false };
  }
  const resolved = path.resolve(projectDir, cwd);
  if (!isSubPath(projectDir, resolved)) {
    return { cwd: projectDir, wasSanitized: true };
  }
  return { cwd: resolved, wasSanitized: false };
}

async function runCommand(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
): Promise<MiyaJobRunResult> {
  const startedAt = nowIso();

  const result = await new Promise<{
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, timedOut, stdout, stderr });
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        timedOut,
        stdout,
        stderr: `${stderr}\n${error.message}`,
      });
    });
  });

  const endedAt = nowIso();
  const status =
    result.exitCode === 0 && !result.timedOut ? 'success' : 'failed';

  return {
    status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
    startedAt,
    endedAt,
  };
}

export class MiyaAutomationService {
  private readonly projectDir: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  getProjectDir(): string {
    return this.projectDir;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, SCHEDULER_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const state = readAutomationState(this.projectDir);
      const now = new Date();

      for (const job of state.jobs) {
        if (!job.enabled) continue;

        const due = new Date(job.nextRunAt).getTime() <= now.getTime();
        if (!due) continue;

        if (job.requireApproval) {
          const hasPendingApproval = state.approvals.some(
            (approval) =>
              approval.jobId === job.id && approval.status === 'pending',
          );
          if (!hasPendingApproval) {
            const approval = createApproval(job, 'Scheduled run is due');
            state.approvals.push(approval);
            job.lastApprovalId = approval.id;
            job.lastStatus = 'skipped';
          }

          job.nextRunAt = computeNextDailyRun(job.schedule.time, now);
          job.updatedAt = nowIso();
          continue;
        }

        await this.executeJobInState(state, job.id, 'scheduler');
      }

      writeAutomationState(this.projectDir, state);
    } finally {
      this.running = false;
    }
  }

  listJobs(): MiyaJob[] {
    return readAutomationState(this.projectDir).jobs;
  }

  listApprovals(): MiyaApprovalRequest[] {
    return readAutomationState(this.projectDir).approvals;
  }

  listHistory(limit = 20): MiyaJobHistoryRecord[] {
    return readHistoryRecords(this.projectDir, limit);
  }

  deleteHistoryRecord(runId: string): boolean {
    return removeHistoryRecord(this.projectDir, runId);
  }

  scheduleDailyCommand(input: {
    name: string;
    time: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    requireApproval?: boolean;
  }): MiyaJob {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('Job name cannot be empty.');
    const command = normalizeCommandText(input.command);
    if (!command) throw new Error('Command cannot be empty.');
    const cwdResolved = resolveAndValidateCwd(this.projectDir, input.cwd);
    if (input.cwd && cwdResolved.wasSanitized) {
      throw new Error('Invalid cwd: must stay within project directory.');
    }

    const now = new Date();
    const job: MiyaJob = {
      id: createJobId(),
      name,
      enabled: true,
      requireApproval: input.requireApproval ?? false,
      schedule: {
        type: 'daily',
        time: String(input.time ?? '').trim(),
      },
      action: {
        type: 'command',
        command,
        cwd: cwdResolved.cwd,
        timeoutMs: normalizeTimeoutMs(input.timeoutMs),
      },
      nextRunAt: computeNextDailyRun(input.time, now),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const state = readAutomationState(this.projectDir);
    state.jobs.push(job);
    writeAutomationState(this.projectDir, state);
    return job;
  }

  deleteJob(jobId: string): boolean {
    const state = readAutomationState(this.projectDir);
    const before = state.jobs.length;
    state.jobs = state.jobs.filter((job) => job.id !== jobId);
    state.approvals = state.approvals.filter(
      (approval) => approval.jobId !== jobId,
    );
    const changed = state.jobs.length !== before;
    if (changed) writeAutomationState(this.projectDir, state);
    return changed;
  }

  setJobEnabled(jobId: string, enabled: boolean): MiyaJob | null {
    const state = readAutomationState(this.projectDir);
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return null;

    job.enabled = enabled;
    if (enabled) {
      job.nextRunAt = computeNextDailyRun(job.schedule.time, new Date());
    }
    job.updatedAt = nowIso();
    writeAutomationState(this.projectDir, state);
    return job;
  }

  async runJobNow(jobId: string): Promise<MiyaJobRunResult | null> {
    const state = readAutomationState(this.projectDir);
    const result = await this.executeJobInState(state, jobId, 'manual');
    writeAutomationState(this.projectDir, state);
    return result;
  }

  async approveAndRun(
    approvalId: string,
  ): Promise<{
    approval: MiyaApprovalRequest;
    result: MiyaJobRunResult | null;
  } | null> {
    const state = readAutomationState(this.projectDir);
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval || approval.status !== 'pending') return null;

    approval.status = 'approved';
    approval.resolvedAt = nowIso();

    const result = await this.executeJobInState(
      state,
      approval.jobId,
      'approval',
    );
    writeAutomationState(this.projectDir, state);
    return { approval, result };
  }

  rejectApproval(approvalId: string): MiyaApprovalRequest | null {
    const state = readAutomationState(this.projectDir);
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval || approval.status !== 'pending') return null;

    approval.status = 'rejected';
    approval.resolvedAt = nowIso();
    writeAutomationState(this.projectDir, state);
    return approval;
  }

  private async executeJobInState(
    state: MiyaAutomationState,
    jobId: string,
    trigger: 'scheduler' | 'manual' | 'approval',
  ): Promise<MiyaJobRunResult | null> {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return null;
    if (!job.enabled && trigger !== 'manual') return null;

    const command = normalizeCommandText(job.action.command);
    const timeoutMs = normalizeTimeoutMs(job.action.timeoutMs);
    const cwdResolved = resolveAndValidateCwd(this.projectDir, job.action.cwd);
    const warning = cwdResolved.wasSanitized
      ? 'Unsafe cwd detected; fell back to project directory.'
      : '';
    if (!command) {
      const failedAt = nowIso();
      const result: MiyaJobRunResult = {
        status: 'failed',
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: 'Empty command is not executable.',
        startedAt: failedAt,
        endedAt: failedAt,
      };
      job.lastRunAt = result.endedAt;
      job.lastStatus = result.status;
      job.lastExitCode = result.exitCode;
      job.nextRunAt = computeNextDailyRun(job.schedule.time, new Date());
      Object.assign(job, touchJob(job));
      appendHistoryRecord(this.projectDir, {
        id: createHistoryId(),
        jobId: job.id,
        jobName: job.name,
        trigger,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        status: result.status,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      return result;
    }

    const result = await runCommand(command, cwdResolved.cwd, timeoutMs);
    if (warning) {
      result.stderr = truncateOutput(
        result.stderr ? `${warning}\n${result.stderr}` : warning,
      );
    }
    job.action.command = command;
    job.action.cwd = cwdResolved.cwd;
    job.action.timeoutMs = timeoutMs;

    job.lastRunAt = result.endedAt;
    job.lastStatus = result.status;
    job.lastExitCode = result.exitCode;
    job.nextRunAt = computeNextDailyRun(job.schedule.time, new Date());
    Object.assign(job, touchJob(job));

    const history: MiyaJobHistoryRecord = {
      id: createHistoryId(),
      jobId: job.id,
      jobName: job.name,
      trigger,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      status: result.status,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    appendHistoryRecord(this.projectDir, history);

    return result;
  }
}
