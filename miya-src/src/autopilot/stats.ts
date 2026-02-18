import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { AutopilotRunDigest, AutopilotStats } from './types';

const RECENT_LIMIT = 40;

function statsFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'autopilot-stats.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStats(): AutopilotStats {
  return {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    rollbackRuns: 0,
    rollbackSuccessRuns: 0,
    verificationRuns: 0,
    verificationFailedRuns: 0,
    totalRetries: 0,
    streakSuccess: 0,
    streakFailure: 0,
    lastFailureReason: undefined,
    updatedAt: nowIso(),
    recent: [],
  };
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readAutopilotStats(projectDir: string): AutopilotStats {
  const file = statsFile(projectDir);
  if (!fs.existsSync(file)) return defaultStats();
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<AutopilotStats>;
    return {
      ...defaultStats(),
      ...parsed,
      recent: Array.isArray(parsed.recent)
        ? parsed.recent.slice(0, RECENT_LIMIT).map((item) => ({
            at: String(item.at ?? nowIso()),
            success: Boolean(item.success),
            commandCount: Math.max(0, Number(item.commandCount ?? 0)),
            retryCount: Math.max(0, Number(item.retryCount ?? 0)),
            verificationAttempted: Boolean(item.verificationAttempted),
            verificationPassed: Boolean(item.verificationPassed),
            rollbackAttempted: Boolean(item.rollbackAttempted),
            rollbackSucceeded: Boolean(item.rollbackSucceeded),
            failureReason:
              typeof item.failureReason === 'string'
                ? item.failureReason.slice(0, 200)
                : undefined,
          }))
        : [],
      updatedAt:
        typeof parsed.updatedAt === 'string' &&
        parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : nowIso(),
    };
  } catch {
    return defaultStats();
  }
}

export function recordAutopilotRunDigest(
  projectDir: string,
  digest: AutopilotRunDigest,
): AutopilotStats {
  const current = readAutopilotStats(projectDir);
  const success = Boolean(digest.success);
  const rollbackAttempted = Boolean(digest.rollbackAttempted);
  const rollbackSucceeded = Boolean(digest.rollbackSucceeded);
  const verificationAttempted = Boolean(digest.verificationAttempted);
  const verificationPassed = Boolean(digest.verificationPassed);
  const retryCount = Math.max(0, Number(digest.retryCount ?? 0));

  const next: AutopilotStats = {
    ...current,
    totalRuns: current.totalRuns + 1,
    successRuns: current.successRuns + (success ? 1 : 0),
    failedRuns: current.failedRuns + (success ? 0 : 1),
    rollbackRuns: current.rollbackRuns + (rollbackAttempted ? 1 : 0),
    rollbackSuccessRuns:
      current.rollbackSuccessRuns + (rollbackSucceeded ? 1 : 0),
    verificationRuns:
      current.verificationRuns + (verificationAttempted ? 1 : 0),
    verificationFailedRuns:
      current.verificationFailedRuns +
      (verificationAttempted && !verificationPassed ? 1 : 0),
    totalRetries: current.totalRetries + retryCount,
    streakSuccess: success ? current.streakSuccess + 1 : 0,
    streakFailure: success ? 0 : current.streakFailure + 1,
    lastFailureReason: success
      ? current.lastFailureReason
      : digest.failureReason?.slice(0, 200) || 'execution_failed',
    updatedAt: nowIso(),
    recent: [
      {
        at: digest.at,
        success,
        commandCount: Math.max(0, Number(digest.commandCount ?? 0)),
        retryCount,
        verificationAttempted,
        verificationPassed,
        rollbackAttempted,
        rollbackSucceeded,
        failureReason: digest.failureReason?.slice(0, 200),
      },
      ...current.recent,
    ].slice(0, RECENT_LIMIT),
  };
  const file = statsFile(projectDir);
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}
