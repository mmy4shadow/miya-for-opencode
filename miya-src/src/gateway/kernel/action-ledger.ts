import { createHash, createHmac, randomUUID } from 'node:crypto';
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

function ledgerFile(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'audit',
    'tool-action-ledger.jsonl',
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
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
    if (Array.isArray(value)) {
      snippets.push(`${key}=[len:${value.length}]`);
      continue;
    }
    if (value && typeof value === 'object') {
      snippets.push(`${key}={object}`);
    }
  }
  return snippets.join(' | ');
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

function replayToken(
  eventID: string,
  method: string,
  inputHash: string,
): string {
  const secret =
    process.env.MIYA_ACTION_LEDGER_SECRET?.trim() || 'miya-action-ledger-v1';
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
  const inputHash = digest(inputSummary);
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
    replayToken: replayToken(id, input.method, inputHash),
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
