import * as fs from 'node:fs';

export type TrustEntityKind = 'target' | 'source' | 'action';
export type TrustTier = 'high' | 'medium' | 'low';

export interface TrustEntityScore {
  score: number;
  approvedCount10: number;
  deniedCount10: number;
  usefulCount10: number;
  uselessCount10: number;
  lastDecisionAt: string;
  autoBlacklisted: boolean;
}

export interface TrustStore {
  entities: Record<string, TrustEntityScore>;
}

export interface TrustUpdateInput {
  kind: TrustEntityKind;
  value: string;
  approved: boolean;
  confidence?: number;
  highRiskRollback?: boolean;
}

const DEFAULT_SCORE = 50;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
const MAX_WINDOW = 10;

function nowIso(): string {
  return new Date().toISOString();
}

function clampScore(value: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.floor(value)));
}

function entityKey(kind: TrustEntityKind, value: string): string {
  return `${kind}:${value.trim().toLowerCase()}`;
}

function shiftWindow(value: number): number {
  const normalized = Math.max(0, Math.floor(value));
  if (normalized < MAX_WINDOW) return normalized;
  return MAX_WINDOW - 1;
}

function readStore(filePath: string): TrustStore {
  if (!fs.existsSync(filePath)) return { entities: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TrustStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.entities)
      return { entities: {} };
    return parsed;
  } catch {
    return { entities: {} };
  }
}

function writeStore(filePath: string, store: TrustStore): void {
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function seedScore(): TrustEntityScore {
  return {
    score: DEFAULT_SCORE,
    approvedCount10: 0,
    deniedCount10: 0,
    usefulCount10: 0,
    uselessCount10: 0,
    lastDecisionAt: nowIso(),
    autoBlacklisted: false,
  };
}

export function getTrustScore(
  filePath: string,
  input: { kind: TrustEntityKind; value?: string },
): number {
  const value = String(input.value ?? '').trim();
  if (!value) return DEFAULT_SCORE;
  const store = readStore(filePath);
  return store.entities[entityKey(input.kind, value)]?.score ?? DEFAULT_SCORE;
}

export function updateTrustScore(
  filePath: string,
  input: TrustUpdateInput,
): TrustEntityScore {
  const value = String(input.value ?? '').trim();
  if (!value) return seedScore();
  const store = readStore(filePath);
  const key = entityKey(input.kind, value);
  const current = store.entities[key] ?? seedScore();
  const confidence = Number.isFinite(input.confidence)
    ? Number(input.confidence)
    : 1;
  let score = current.score;

  if (input.highRiskRollback) {
    score = 20;
  } else if (input.approved) {
    score += 5;
  } else {
    score -= 8;
  }
  if (confidence < 0.5) score -= 10;

  const nextApproved = input.approved
    ? shiftWindow(current.approvedCount10) + 1
    : shiftWindow(current.approvedCount10);
  const nextDenied = input.approved
    ? shiftWindow(current.deniedCount10)
    : shiftWindow(current.deniedCount10) + 1;

  const useful = input.approved
    ? shiftWindow(current.usefulCount10) + 1
    : shiftWindow(current.usefulCount10);
  const useless = input.approved
    ? shiftWindow(current.uselessCount10)
    : shiftWindow(current.uselessCount10) + 1;
  const autoBlacklisted = useful < useless;

  const next: TrustEntityScore = {
    score: clampScore(score),
    approvedCount10: Math.min(MAX_WINDOW, nextApproved),
    deniedCount10: Math.min(MAX_WINDOW, nextDenied),
    usefulCount10: Math.min(MAX_WINDOW, useful),
    uselessCount10: Math.min(MAX_WINDOW, useless),
    lastDecisionAt: nowIso(),
    autoBlacklisted,
  };
  store.entities[key] = next;
  writeStore(filePath, store);
  return next;
}

export function trustTierFromScore(score: number): TrustTier {
  if (score >= 90) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}
