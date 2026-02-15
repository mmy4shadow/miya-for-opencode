import * as fs from 'node:fs';
import type { SentinelState } from './state-machine';
import type { PsycheUrgency } from './consult';

export interface BucketStats {
  alpha: number;
  beta: number;
  updatedAt: string;
}

export interface FastBrainStore {
  buckets: Record<string, BucketStats>;
}

export const DEFAULT_FAST_BRAIN: FastBrainStore = { buckets: {} };
export const MAX_BUCKETS = 1200;

function nowIso(): string {
  return new Date().toISOString();
}

function safeReadJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function fastBrainBucket(input: {
  state: SentinelState;
  intent: string;
  urgency: PsycheUrgency;
  channel?: string;
  userInitiated: boolean;
}): string {
  const normalizedIntent = input.intent.trim().toLowerCase() || 'unknown_intent';
  const channel = (input.channel || 'none').trim().toLowerCase() || 'none';
  return [
    `state=${input.state}`,
    `intent=${normalizedIntent}`,
    `urgency=${input.urgency}`,
    `channel=${channel}`,
    `user=${input.userInitiated ? '1' : '0'}`,
  ].join('|');
}

export function readFastBrainScore(
  fastBrainPath: string,
  input: {
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
  },
): number {
  const store = safeReadJson<FastBrainStore>(fastBrainPath, DEFAULT_FAST_BRAIN);
  const key = fastBrainBucket(input);
  const stats = store.buckets[key];
  if (!stats) return 0.5;
  const alpha = Number.isFinite(stats.alpha) ? stats.alpha : 1;
  const beta = Number.isFinite(stats.beta) ? stats.beta : 1;
  const total = alpha + beta;
  if (!Number.isFinite(total) || total <= 0) return 0.5;
  return Math.max(0, Math.min(1, alpha / total));
}

export function touchFastBrain(
  fastBrainPath: string,
  input: {
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    approved: boolean;
  },
): void {
  const store = safeReadJson<FastBrainStore>(fastBrainPath, DEFAULT_FAST_BRAIN);
  const key = fastBrainBucket(input);
  const current = store.buckets[key] ?? {
    alpha: 1,
    beta: 1,
    updatedAt: nowIso(),
  };
  if (input.approved) {
    current.alpha += 1;
  } else {
    current.beta += 1;
  }
  current.updatedAt = nowIso();
  store.buckets[key] = current;
  trimOldBuckets(store);
  fs.writeFileSync(fastBrainPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

export function adjustFastBrain(
  fastBrainPath: string,
  key: string,
  alphaDelta: number,
  betaDelta: number,
): void {
  const store = safeReadJson<FastBrainStore>(fastBrainPath, DEFAULT_FAST_BRAIN);
  const current = store.buckets[key] ?? {
    alpha: 1,
    beta: 1,
    updatedAt: nowIso(),
  };
  const alpha = Number.isFinite(current.alpha) ? current.alpha : 1;
  const beta = Number.isFinite(current.beta) ? current.beta : 1;
  current.alpha = Math.max(1, alpha + Math.max(0, alphaDelta));
  current.beta = Math.max(1, beta + Math.max(0, betaDelta));
  current.updatedAt = nowIso();
  store.buckets[key] = current;
  trimOldBuckets(store);
  fs.writeFileSync(fastBrainPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function trimOldBuckets(store: FastBrainStore): void {
  const keys = Object.keys(store.buckets);
  if (keys.length <= MAX_BUCKETS) return;
  keys
    .sort((a, b) => Date.parse(store.buckets[a].updatedAt) - Date.parse(store.buckets[b].updatedAt))
    .slice(0, keys.length - MAX_BUCKETS)
    .forEach((keyToDelete) => {
      delete store.buckets[keyToDelete];
    });
}
