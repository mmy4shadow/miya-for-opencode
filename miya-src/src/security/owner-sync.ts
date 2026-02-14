import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface OwnerSyncTokenRecord {
  token: string;
  action: string;
  payloadHash: string;
  status: 'pending' | 'approved' | 'consumed';
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  approvedBy?: {
    channel: 'qq' | 'wechat';
    senderID: string;
  };
  consumedAt?: string;
}

interface OwnerSyncStore {
  tokens: OwnerSyncTokenRecord[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function storeFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'security', 'owner-sync.json');
}

function readStore(projectDir: string): OwnerSyncStore {
  const file = storeFile(projectDir);
  if (!fs.existsSync(file)) return { tokens: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as OwnerSyncStore;
    return Array.isArray(parsed.tokens) ? parsed : { tokens: [] };
  } catch {
    return { tokens: [] };
  }
}

function writeStore(projectDir: string, store: OwnerSyncStore): void {
  const file = storeFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function purgeExpired(tokens: OwnerSyncTokenRecord[]): OwnerSyncTokenRecord[] {
  const now = Date.now();
  return tokens.filter((item) => {
    const expiresAt = Date.parse(item.expiresAt);
    if (!Number.isFinite(expiresAt)) return false;
    if (expiresAt < now && item.status === 'pending') return false;
    return true;
  });
}

function normalizeToken(input: string): string {
  return input.trim().toUpperCase();
}

function createToken(): string {
  return `OS${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}

export function issueOwnerSyncToken(
  projectDir: string,
  input: { action: string; payloadHash: string; ttlMs?: number },
): OwnerSyncTokenRecord {
  const ttlMs = Math.max(60_000, Number(input.ttlMs ?? 10 * 60_000));
  const store = readStore(projectDir);
  store.tokens = purgeExpired(store.tokens);
  const now = Date.now();
  const existing = store.tokens.find(
    (item) =>
      item.status === 'pending' &&
      item.action === input.action &&
      item.payloadHash === input.payloadHash &&
      Date.parse(item.expiresAt) > now,
  );
  if (existing) {
    writeStore(projectDir, store);
    return existing;
  }
  const createdAt = nowIso();
  const record: OwnerSyncTokenRecord = {
    token: createToken(),
    action: input.action,
    payloadHash: input.payloadHash,
    status: 'pending',
    createdAt,
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  store.tokens.unshift(record);
  store.tokens = store.tokens.slice(0, 500);
  writeStore(projectDir, store);
  return record;
}

export function approveOwnerSyncToken(
  projectDir: string,
  input: { token: string; channel: 'qq' | 'wechat'; senderID: string },
): { ok: boolean; reason?: string; record?: OwnerSyncTokenRecord } {
  const token = normalizeToken(input.token);
  if (!token) return { ok: false, reason: 'owner_sync_token_empty' };
  const store = readStore(projectDir);
  store.tokens = purgeExpired(store.tokens);
  const found = store.tokens.find((item) => item.token === token);
  if (!found) {
    writeStore(projectDir, store);
    return { ok: false, reason: 'owner_sync_token_not_found' };
  }
  if (found.status !== 'pending') {
    writeStore(projectDir, store);
    return { ok: false, reason: `owner_sync_token_not_pending:${found.status}` };
  }
  if (Date.parse(found.expiresAt) <= Date.now()) {
    writeStore(projectDir, store);
    return { ok: false, reason: 'owner_sync_token_expired' };
  }
  found.status = 'approved';
  found.approvedAt = nowIso();
  found.approvedBy = { channel: input.channel, senderID: input.senderID };
  writeStore(projectDir, store);
  return { ok: true, record: found };
}

export function verifyOwnerSyncToken(
  projectDir: string,
  input: { token: string; action: string; payloadHash: string },
): { ok: boolean; reason?: string; record?: OwnerSyncTokenRecord } {
  const token = normalizeToken(input.token);
  if (!token) return { ok: false, reason: 'owner_sync_token_empty' };
  const store = readStore(projectDir);
  store.tokens = purgeExpired(store.tokens);
  const found = store.tokens.find((item) => item.token === token);
  if (!found) {
    writeStore(projectDir, store);
    return { ok: false, reason: 'owner_sync_token_not_found' };
  }
  if (found.status !== 'approved') {
    writeStore(projectDir, store);
    return { ok: false, reason: `owner_sync_token_not_approved:${found.status}` };
  }
  if (found.action !== input.action) {
    writeStore(projectDir, store);
    return { ok: false, reason: 'owner_sync_token_action_mismatch' };
  }
  if (found.payloadHash !== input.payloadHash) {
    writeStore(projectDir, store);
    return { ok: false, reason: 'owner_sync_token_payload_mismatch' };
  }
  if (Date.parse(found.expiresAt) <= Date.now()) {
    writeStore(projectDir, store);
    return { ok: false, reason: 'owner_sync_token_expired' };
  }
  writeStore(projectDir, store);
  return { ok: true, record: found };
}

export function consumeOwnerSyncToken(
  projectDir: string,
  tokenInput: string,
): { ok: boolean; reason?: string } {
  const token = normalizeToken(tokenInput);
  if (!token) return { ok: false, reason: 'owner_sync_token_empty' };
  const store = readStore(projectDir);
  store.tokens = purgeExpired(store.tokens);
  const found = store.tokens.find((item) => item.token === token);
  if (!found) {
    writeStore(projectDir, store);
    return { ok: false, reason: 'owner_sync_token_not_found' };
  }
  if (found.status !== 'approved') {
    writeStore(projectDir, store);
    return { ok: false, reason: `owner_sync_token_not_approved:${found.status}` };
  }
  found.status = 'consumed';
  found.consumedAt = nowIso();
  writeStore(projectDir, store);
  return { ok: true };
}

export function detectOwnerSyncTokenFromText(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) return null;
  const matched =
    /(?:同意|确认|approve|confirm|ok)\s*[:：#]?\s*([a-z0-9_-]{6,64})/i.exec(normalized) ??
    /(?:\/miya\s+confirm)\s+([a-z0-9_-]{6,64})/i.exec(normalized);
  if (!matched?.[1]) return null;
  return normalizeToken(matched[1]);
}

