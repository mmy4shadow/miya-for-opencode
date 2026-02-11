import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMiyaRuntimeDir } from '../workflow';
import { type SafetyTier, tierAtLeast } from './tier';

const RECORD_LIMIT = 500;
const TOKEN_TTL_MS = 120_000;
const TOKEN_LIMIT_PER_SESSION = 200;

export interface SelfApprovalRecord {
  id: string;
  trace_id: string;
  session_id: string;
  request_hash?: string;
  action: string;
  tier: SafetyTier;
  status: 'allow' | 'deny';
  reason: string;
  checks: string[];
  evidence: string[];
  executor: {
    agent: string;
    plan: string;
  };
  verifier: {
    agent: string;
    verdict: 'allow' | 'deny';
    summary: string;
  };
  rollback: {
    strategy: string;
  };
  created_at: string;
}

export interface ApprovalToken {
  trace_id: string;
  request_hash: string;
  tier: SafetyTier;
  created_at: string;
  expires_at: string;
  action: string;
}

interface ApprovalTokenStore {
  tokens: Record<string, Record<string, ApprovalToken>>;
}

interface SelfApprovalStore {
  records: SelfApprovalRecord[];
}

interface KillSwitchState {
  active: boolean;
  reason?: string;
  trace_id?: string;
  activated_at?: string;
}

function runtimeFile(projectDir: string, name: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), name);
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createTraceId(): string {
  return randomUUID();
}

export function writeSelfApprovalRecord(
  projectDir: string,
  record: Omit<SelfApprovalRecord, 'id' | 'created_at'>,
): SelfApprovalRecord {
  const file = runtimeFile(projectDir, 'self-approval.json');
  const current = readJson<SelfApprovalStore>(file, { records: [] });
  const next: SelfApprovalRecord = {
    id: randomUUID(),
    created_at: nowIso(),
    ...record,
  };
  current.records = [next, ...current.records].slice(0, RECORD_LIMIT);
  writeJson(file, current);
  return next;
}

export function listRecentSelfApprovalRecords(
  projectDir: string,
  limit = 10,
): SelfApprovalRecord[] {
  const file = runtimeFile(projectDir, 'self-approval.json');
  const current = readJson<SelfApprovalStore>(file, { records: [] });
  return current.records.slice(0, Math.max(1, limit));
}

function readTokenStore(projectDir: string): ApprovalTokenStore {
  const file = runtimeFile(projectDir, 'approval-tokens.json');
  return readJson<ApprovalTokenStore>(file, { tokens: {} });
}

function writeTokenStore(projectDir: string, store: ApprovalTokenStore): void {
  const file = runtimeFile(projectDir, 'approval-tokens.json');
  writeJson(file, store);
}

export function saveApprovalToken(
  projectDir: string,
  sessionID: string,
  token: Omit<ApprovalToken, 'created_at' | 'expires_at'>,
  ttlMs = TOKEN_TTL_MS,
): ApprovalToken {
  const store = readTokenStore(projectDir);
  const created = new Date();
  const expires = new Date(created.getTime() + ttlMs);
  const next: ApprovalToken = {
    ...token,
    created_at: created.toISOString(),
    expires_at: expires.toISOString(),
  };
  const sessionTokens = store.tokens[sessionID] ?? {};
  sessionTokens[token.request_hash] = next;
  const normalized = Object.values(sessionTokens)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, TOKEN_LIMIT_PER_SESSION);
  store.tokens[sessionID] = Object.fromEntries(
    normalized.map((entry) => [entry.request_hash, entry]),
  );
  writeTokenStore(projectDir, store);
  return next;
}

export function findApprovalToken(
  projectDir: string,
  sessionID: string,
  requestHashes: string[],
  requiredTier: SafetyTier,
): ApprovalToken | null {
  const store = readTokenStore(projectDir);
  const sessionTokens = store.tokens[sessionID] ?? {};
  const now = Date.now();

  for (const hash of requestHashes) {
    const token = sessionTokens[hash];
    if (!token) continue;
    const expiresAt = Date.parse(token.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt < now) continue;
    if (!tierAtLeast(token.tier, requiredTier)) continue;
    return token;
  }
  return null;
}

export function readKillSwitch(projectDir: string): KillSwitchState {
  return readJson<KillSwitchState>(runtimeFile(projectDir, 'kill-switch.json'), {
    active: false,
  });
}

export function activateKillSwitch(
  projectDir: string,
  reason: string,
  traceID: string,
): KillSwitchState {
  const next: KillSwitchState = {
    active: true,
    reason,
    trace_id: traceID,
    activated_at: nowIso(),
  };
  writeJson(runtimeFile(projectDir, 'kill-switch.json'), next);
  return next;
}

export function releaseKillSwitch(projectDir: string): KillSwitchState {
  const next: KillSwitchState = { active: false };
  writeJson(runtimeFile(projectDir, 'kill-switch.json'), next);
  return next;
}
