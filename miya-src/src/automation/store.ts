import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaAutomationDir } from '../model/paths';
import type {
  MiyaApprovalRequest,
  MiyaAutomationState,
  MiyaJob,
  MiyaJobHistoryRecord,
} from './types';

const DEFAULT_STATE: MiyaAutomationState = {
  jobs: [],
  approvals: [],
};

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}_${rand}`;
}

function getStatePath(projectDir: string): string {
  return path.join(getMiyaAutomationDir(projectDir), 'state.json');
}

function getHistoryPath(projectDir: string): string {
  return path.join(getMiyaAutomationDir(projectDir), 'history.jsonl');
}

export function readAutomationState(projectDir: string): MiyaAutomationState {
  const statePath = getStatePath(projectDir);
  if (!fs.existsSync(statePath)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MiyaAutomationState>;
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeAutomationState(
  projectDir: string,
  state: MiyaAutomationState,
): void {
  const statePath = getStatePath(projectDir);
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function appendHistoryRecord(
  projectDir: string,
  record: MiyaJobHistoryRecord,
): void {
  const historyPath = getHistoryPath(projectDir);
  ensureDir(path.dirname(historyPath));
  fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`, 'utf-8');
}

export function readHistoryRecords(
  projectDir: string,
  limit: number,
): MiyaJobHistoryRecord[] {
  const historyPath = getHistoryPath(projectDir);
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  try {
    const lines = fs
      .readFileSync(historyPath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const records = lines
      .map((line) => JSON.parse(line) as MiyaJobHistoryRecord)
      .filter((record) => record && typeof record === 'object');

    return records.slice(Math.max(0, records.length - limit)).reverse();
  } catch {
    return [];
  }
}

export function removeHistoryRecord(
  projectDir: string,
  runId: string,
): boolean {
  const historyPath = getHistoryPath(projectDir);
  if (!fs.existsSync(historyPath)) {
    return false;
  }

  const normalizedRunId = String(runId ?? '').trim();
  if (!normalizedRunId) {
    return false;
  }

  try {
    const lines = fs
      .readFileSync(historyPath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const records = lines
      .map((line) => JSON.parse(line) as MiyaJobHistoryRecord)
      .filter((record) => record && typeof record === 'object');

    const filtered = records.filter((record) => record.id !== normalizedRunId);
    if (filtered.length === records.length) {
      return false;
    }

    const output =
      filtered.length > 0
        ? `${filtered.map((record) => JSON.stringify(record)).join('\n')}\n`
        : '';
    fs.writeFileSync(historyPath, output, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function createJobId(): string {
  return randomId('job');
}

export function createApprovalId(): string {
  return randomId('approval');
}

export function createHistoryId(): string {
  return randomId('run');
}

export function touchJob(job: MiyaJob): MiyaJob {
  return {
    ...job,
    updatedAt: nowIso(),
  };
}

export function createApproval(
  job: MiyaJob,
  reason: string,
): MiyaApprovalRequest {
  return {
    id: createApprovalId(),
    jobId: job.id,
    reason,
    requestedAt: nowIso(),
    status: 'pending',
  };
}
