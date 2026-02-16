import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { recordStrategyObservation, resolveStrategyVariant } from '../strategy';
import {
  getMemoryReflectStatus,
  reflectCompanionMemory,
  type ReflectResult,
} from './memory-reflect';
import { mergePendingMemoryConflicts } from './memory-vector';

export interface ReflectWorkerRequest {
  reason: 'manual' | 'auto_idle' | 'session_end' | 'budget_retry';
  force?: boolean;
  minLogs?: number;
  maxLogs?: number;
  maxWrites?: number;
  cooldownMinutes?: number;
}

export interface ReflectWorkerJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  request: ReflectWorkerRequest;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  mergedConflicts?: number;
  result?: Pick<
    ReflectResult,
    | 'jobID'
    | 'processedLogs'
    | 'generatedTriplets'
    | 'generatedFacts'
    | 'generatedInsights'
    | 'generatedPreferences'
    | 'archivedLogs'
  >;
  error?: string;
}

interface ReflectWorkerStore {
  version: 1;
  jobs: ReflectWorkerJob[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function queueFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'memory', 'reflect-queue.json');
}

function readStore(projectDir: string): ReflectWorkerStore {
  const file = queueFile(projectDir);
  if (!fs.existsSync(file)) return { version: 1, jobs: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ReflectWorkerStore>;
    return {
      version: 1,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return { version: 1, jobs: [] };
  }
}

function writeStore(projectDir: string, store: ReflectWorkerStore): ReflectWorkerStore {
  const file = queueFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next: ReflectWorkerStore = {
    version: 1,
    jobs: store.jobs.slice(0, 200),
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

export function enqueueReflectWorkerJob(
  projectDir: string,
  request: ReflectWorkerRequest,
): ReflectWorkerJob {
  const store = readStore(projectDir);
  const duplicate = store.jobs.find(
    (job) => job.status === 'queued' && job.request.reason === request.reason,
  );
  if (duplicate) return duplicate;
  const now = nowIso();
  const job: ReflectWorkerJob = {
    id: `mrw_${randomUUID()}`,
    status: 'queued',
    request: {
      reason: request.reason,
      force: request.force === true,
      minLogs:
        typeof request.minLogs === 'number' && request.minLogs > 0
          ? Number(request.minLogs)
          : undefined,
      maxLogs:
        typeof request.maxLogs === 'number' && request.maxLogs > 0
          ? Number(request.maxLogs)
          : undefined,
      maxWrites:
        typeof request.maxWrites === 'number' && request.maxWrites > 0
          ? Number(request.maxWrites)
          : undefined,
      cooldownMinutes:
        typeof request.cooldownMinutes === 'number' && request.cooldownMinutes >= 0
          ? Number(request.cooldownMinutes)
          : undefined,
    },
    createdAt: now,
    updatedAt: now,
  };
  store.jobs = [job, ...store.jobs].slice(0, 200);
  writeStore(projectDir, store);
  return job;
}

export function listReflectWorkerJobs(
  projectDir: string,
  limit = 30,
): ReflectWorkerJob[] {
  const store = readStore(projectDir);
  return store.jobs.slice(0, Math.max(1, Math.min(200, limit)));
}

export function scheduleAutoReflectJob(
  projectDir: string,
  input?: {
    idleMinutes?: number;
    minPendingLogs?: number;
    cooldownMinutes?: number;
    maxLogs?: number;
    maxWrites?: number;
  },
): ReflectWorkerJob | null {
  const idleMinutes = Math.max(1, input?.idleMinutes ?? 5);
  const minPendingLogs = Math.max(1, input?.minPendingLogs ?? 1);
  const cooldownMinutes = Math.max(1, input?.cooldownMinutes ?? 3);
  const status = getMemoryReflectStatus(projectDir);
  if (status.pendingLogs < minPendingLogs) return null;
  if (!status.lastLogAt) return null;
  const nowMs = Date.now();
  const idleMs = nowMs - Date.parse(status.lastLogAt);
  if (!Number.isFinite(idleMs) || idleMs < idleMinutes * 60 * 1000) return null;
  if (status.lastReflectAt) {
    const cooldownMs = nowMs - Date.parse(status.lastReflectAt);
    if (Number.isFinite(cooldownMs) && cooldownMs < cooldownMinutes * 60 * 1000) return null;
  }
  return enqueueReflectWorkerJob(projectDir, {
    reason: 'auto_idle',
    force: true,
    minLogs: minPendingLogs,
    maxLogs: input?.maxLogs ?? 120,
    maxWrites: input?.maxWrites ?? 40,
    cooldownMinutes,
  });
}

export function runReflectWorkerTick(
  projectDir: string,
  input?: { maxJobs?: number; writeBudget?: number; mergeBudget?: number },
): {
  processed: number;
  completed: number;
  failed: number;
  jobs: ReflectWorkerJob[];
} {
  const maxJobs = Math.max(1, Math.min(5, Math.floor(input?.maxJobs ?? 1)));
  const writeBudget = Math.max(1, Math.min(200, Math.floor(input?.writeBudget ?? 40)));
  const mergeBudget = Math.max(1, Math.min(200, Math.floor(input?.mergeBudget ?? 40)));
  const store = readStore(projectDir);
  const jobs = store.jobs;
  const toRun = jobs.filter((job) => job.status === 'queued').slice(0, maxJobs);
  let completed = 0;
  let failed = 0;

  for (const job of toRun) {
    job.status = 'running';
    job.startedAt = nowIso();
    job.updatedAt = job.startedAt;
    writeStore(projectDir, store);
    try {
      const result = reflectCompanionMemory(projectDir, {
        force: job.request.force,
        minLogs: job.request.minLogs,
        maxLogs: job.request.maxLogs,
        maxWrites: Math.min(writeBudget, job.request.maxWrites ?? writeBudget),
        cooldownMinutes: job.request.cooldownMinutes,
        idempotencyKey: job.id,
        mergeConflicts: true,
      });
      const merged = mergePendingMemoryConflicts(projectDir, {
        maxSupersede: mergeBudget,
      });
      job.status = 'completed';
      job.finishedAt = nowIso();
      job.updatedAt = job.finishedAt;
      job.mergedConflicts = merged.merged;
      job.result = {
        jobID: result.jobID,
        processedLogs: result.processedLogs,
        generatedTriplets: result.generatedTriplets,
        generatedFacts: result.generatedFacts,
        generatedInsights: result.generatedInsights,
        generatedPreferences: result.generatedPreferences,
        archivedLogs: result.archivedLogs,
      };
      recordStrategyObservation(projectDir, {
        experiment: 'memory_write',
        variant: resolveStrategyVariant(projectDir, 'memory_write', job.id),
        subjectID: job.id,
        success: result.processedLogs > 0 || result.generatedTriplets > 0,
        riskScore: merged.merged > 0 ? 0.25 : 0.1,
        metadata: {
          reason: job.request.reason,
          processedLogs: result.processedLogs,
          generatedTriplets: result.generatedTriplets,
          mergedConflicts: merged.merged,
        },
      });
      completed += 1;
    } catch (error) {
      job.status = 'failed';
      job.finishedAt = nowIso();
      job.updatedAt = job.finishedAt;
      job.error = error instanceof Error ? error.message : String(error);
      recordStrategyObservation(projectDir, {
        experiment: 'memory_write',
        variant: resolveStrategyVariant(projectDir, 'memory_write', job.id),
        subjectID: job.id,
        success: false,
        riskScore: 0.8,
        metadata: {
          reason: job.request.reason,
          error: job.error,
        },
      });
      failed += 1;
    }
    writeStore(projectDir, store);
  }

  return {
    processed: toRun.length,
    completed,
    failed,
    jobs: toRun,
  };
}
