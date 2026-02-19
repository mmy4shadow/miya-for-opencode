import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../workflow';
import type { GatewayClientRole } from '../protocol';

export type ActionLedgerStatus = 'completed' | 'failed';

export interface ToolActionLedgerEvent {
  id: string;
  at: string;
  method: string;
  clientID: string;
  role: GatewayClientRole;
  status: ActionLedgerStatus;
  inputSummary: string;
  inputHash: string;
  approvalBasis: string;
  resultHash: string;
  replayToken: string;
  previousHash: string;
  entryHash: string;
}

export interface ToolActionLedgerIssue {
  line: number;
  id?: string;
  reason: string;
}

export interface ToolActionLedgerVerificationReport {
  ok: boolean;
  total: number;
  valid: number;
  issues: ToolActionLedgerIssue[];
}

function ledgerFile(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'audit',
    'tool-action-ledger.jsonl',
  );
}

function ledgerSecretFile(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'audit',
    'tool-action-ledger.secret',
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function canonicalSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'bigint') return `"${value.toString()}n"`;
  if (typeof value === 'function') return '"[function]"';
  if (typeof value === 'symbol') return JSON.stringify(String(value));
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSerialize(item, seen)).join(',')}]`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object') {
    if (seen.has(value)) return '"[circular]"';
    seen.add(value);
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(obj[key], seen)}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function hashPayload(value: unknown): string {
  const serialized = canonicalSerialize(value);
  const bounded = serialized.length > 131072 ? serialized.slice(0, 131072) : serialized;
  return digest(bounded);
}

function summarizeParams(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  if (keys.length === 0) return '(no_params)';
  const snippets: string[] = [];
  for (const key of keys.slice(0, 16)) {
    const value = params[key];
    if (typeof value === 'string') {
      snippets.push(`${key}=${value.slice(0, 120)}`);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      snippets.push(`${key}=${String(value)}`);
      continue;
    }
    if (value === null || value === undefined) {
      snippets.push(`${key}=${String(value)}`);
      continue;
    }
    if (Array.isArray(value)) {
      snippets.push(`${key}=[len:${value.length}]`);
      continue;
    }
    if (value && typeof value === 'object') {
      snippets.push(`${key}={object}`);
    }
  }
  return snippets.length > 0 ? snippets.join(' | ') : `(keys:${keys.length})`;
}

function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) return 'null';
  if (typeof result === 'string') return result.slice(0, 240);
  if (typeof result === 'number' || typeof result === 'boolean')
    return String(result);
  try {
    return JSON.stringify(result).slice(0, 400);
  } catch {
    return String(result).slice(0, 400);
  }
}

function resolveReplaySecret(projectDir: string): string {
  const envSecret = process.env.MIYA_ACTION_LEDGER_SECRET?.trim();
  if (envSecret) return envSecret;
  const file = ledgerSecretFile(projectDir);
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (existing) return existing;
  } catch {
    // Ignore and generate below.
  }
  const generated = randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${generated}\n`, { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Keep runtime available even if persistence fails.
  }
  return generated;
}

function replayToken(
  projectDir: string,
  eventID: string,
  method: string,
  inputHash: string,
): string {
  const secret = resolveReplaySecret(projectDir);
  return createHmac('sha256', secret)
    .update(`${eventID}:${method}:${inputHash}`)
    .digest('hex');
}

function safeReadRows(file: string): ToolActionLedgerEvent[] {
  if (!fs.existsSync(file)) return [];
  const rows: ToolActionLedgerEvent[] = [];
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line) as ToolActionLedgerEvent);
    } catch {
      // Keep ledger append resilient even with malformed historical lines.
    }
  }
  return rows;
}

function deriveApprovalBasis(params: Record<string, unknown>): string {
  const policyHash =
    typeof params.policyHash === 'string' && params.policyHash.trim()
      ? params.policyHash.trim()
      : undefined;
  const approvalID =
    typeof params.approvalID === 'string' && params.approvalID.trim()
      ? params.approvalID.trim()
      : undefined;
  if (policyHash && approvalID) {
    return `policy_hash+approval_id:${policyHash.slice(0, 16)}:${approvalID.slice(0, 24)}`;
  }
  if (policyHash) return `policy_hash:${policyHash.slice(0, 16)}`;
  if (approvalID) return `approval_id:${approvalID.slice(0, 24)}`;
  return 'implicit_or_not_required';
}

export function appendToolActionLedgerEvent(
  projectDir: string,
  input: {
    method: string;
    clientID: string;
    role: GatewayClientRole;
    params: Record<string, unknown>;
    status: ActionLedgerStatus;
    result?: unknown;
    error?: unknown;
    approvalBasis?: string;
  },
): ToolActionLedgerEvent {
  const file = ledgerFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = safeReadRows(file);
  const previousHash = rows[rows.length - 1]?.entryHash ?? 'GENESIS';
  const inputSummary = summarizeParams(input.params);
  const inputHash = hashPayload(input.params);
  const resultText =
    input.status === 'completed'
      ? summarizeResult(input.result)
      : summarizeResult(input.error);
  const resultHash = digest(resultText);
  const id = `tae_${randomUUID()}`;
  const approvalBasis =
    input.approvalBasis?.trim() || deriveApprovalBasis(input.params);
  const at = nowIso();
  const entryHash = digest(
    [
      id,
      at,
      input.method,
      input.clientID,
      input.role,
      input.status,
    inputHash,
    approvalBasis,
    resultHash,
    previousHash,
  ].join('|'),
  );
  const event: ToolActionLedgerEvent = {
    id,
    at,
    method: input.method,
    clientID: input.clientID,
    role: input.role,
    status: input.status,
    inputSummary,
    inputHash,
    approvalBasis,
    resultHash,
    replayToken: replayToken(projectDir, id, input.method, inputHash),
    previousHash,
    entryHash,
  };
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf-8');
  return event;
}

export function listToolActionLedgerEvents(
  projectDir: string,
  limit = 100,
): ToolActionLedgerEvent[] {
  const rows = safeReadRows(ledgerFile(projectDir));
  return rows.slice(-Math.max(1, Math.min(1000, limit))).reverse();
}

export function verifyToolActionLedger(
  projectDir: string,
): ToolActionLedgerVerificationReport {
  const file = ledgerFile(projectDir);
  if (!fs.existsSync(file)) {
    return { ok: true, total: 0, valid: 0, issues: [] };
  }
  const issues: ToolActionLedgerIssue[] = [];
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
  let expectedPreviousHash = 'GENESIS';
  let valid = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    if (!line) continue;
    let event: ToolActionLedgerEvent;
    try {
      event = JSON.parse(line) as ToolActionLedgerEvent;
    } catch {
      issues.push({ line: lineNo, reason: 'malformed_json' });
      continue;
    }
    const actualPreviousHash = String(event.previousHash ?? '');
    if (actualPreviousHash !== expectedPreviousHash) {
      issues.push({
        line: lineNo,
        id: event.id,
        reason: `previous_hash_mismatch(expected=${expectedPreviousHash},actual=${actualPreviousHash || '(empty)'})`,
      });
    }
    const expectedEntryHash = digest(
      [
        event.id,
        event.at,
        event.method,
        event.clientID,
        event.role,
        event.status,
        event.inputHash,
        event.approvalBasis,
        event.resultHash,
        event.previousHash,
      ].join('|'),
    );
    if (String(event.entryHash ?? '') !== expectedEntryHash) {
      issues.push({
        line: lineNo,
        id: event.id,
        reason: 'entry_hash_mismatch',
      });
    }
    expectedPreviousHash = String(event.entryHash ?? expectedPreviousHash);
    valid += 1;
  }
  return {
    ok: issues.length === 0,
    total: lines.length,
    valid,
    issues,
  };
}
