import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { AgentModelSelectionFromEvent } from './agent-model-persistence';

const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_STRING_LENGTH = 4000;
const MAX_DEPTH = 8;

const SENSITIVE_KEY_PATTERNS = [
  /api[-_]?key/i,
  /token/i,
  /authorization/i,
  /secret/i,
  /password/i,
  /cookie/i,
];

const MODEL_EVENT_KEYWORDS = [
  'settings.',
  'config.',
  'agent.',
  'model',
  'provider',
  'session.agent',
];

const MODEL_SIGNAL_KEYWORDS = [
  'model',
  'provider',
  'agent',
  'default_agent',
  'defaultagent',
  'selectedagent',
  'activeagent',
  'currentagent',
  'baseurl',
  'apikey',
];

function textHasModelSignal(value: string): boolean {
  const lowered = value.trim().toLowerCase();
  if (!lowered) return false;
  return MODEL_SIGNAL_KEYWORDS.some((keyword) => lowered.includes(keyword));
}

function containsModelSignal(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'undefined') return false;
  if (depth > 6) return false;
  if (typeof value === 'string') return textHasModelSignal(value);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsModelSignal(item, depth + 1));
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (textHasModelSignal(key)) return true;
      if (containsModelSignal(item, depth + 1)) return true;
    }
  }
  return false;
}

export function shouldAuditModelEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const eventType = String((event as { type?: unknown }).type ?? '')
    .trim()
    .toLowerCase();
  if (
    eventType &&
    MODEL_EVENT_KEYWORDS.some((keyword) => eventType.includes(keyword))
  ) {
    return true;
  }
  return containsModelSignal(
    (event as { properties?: unknown }).properties ?? event,
  );
}

function shouldMirrorHomeAudit(): boolean {
  const envValue = String(
    process.env.MIYA_MODEL_EVENT_AUDIT_MIRROR_HOME ?? '',
  ).trim();
  if (envValue === '1') return true;
  if (envValue === '0') return false;
  return process.platform === 'win32';
}

function auditFiles(projectDir: string): string[] {
  const runtimeFile = path.join(
    getMiyaRuntimeDir(projectDir),
    'audit',
    'model-event-frames.jsonl',
  );
  const candidates = [runtimeFile];
  if (shouldMirrorHomeAudit()) {
    candidates.push(
      path.join(
        os.homedir(),
        '.opencode',
        'miya',
        'audit',
        'model-event-frames.jsonl',
      ),
    );
  }
  return Array.from(new Set(candidates));
}

function rotateAuditFile(file: string): void {
  if (!fs.existsSync(file)) return;
  const stat = fs.statSync(file);
  if (stat.size < MAX_AUDIT_FILE_BYTES) return;

  const prev1 = `${file}.1`;
  const prev2 = `${file}.2`;
  if (fs.existsSync(prev2)) fs.unlinkSync(prev2);
  if (fs.existsSync(prev1)) fs.renameSync(prev1, prev2);
  fs.renameSync(file, prev1);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function truncateString(text: string): string {
  if (text.length <= MAX_STRING_LENGTH) return text;
  return `${text.slice(0, MAX_STRING_LENGTH)}...(truncated:${text.length})`;
}

function sanitizeForAudit(
  value: unknown,
  depth = 0,
  visited = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === 'undefined') return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return '[max_depth]';

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAudit(item, depth + 1, visited));
  }

  if (typeof value === 'object') {
    if (visited.has(value as object)) return '[circular]';
    visited.add(value as object);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isSensitiveKey(key)) {
        result[key] = '[redacted]';
        continue;
      }
      result[key] = sanitizeForAudit(item, depth + 1, visited);
    }
    return result;
  }

  return String(value);
}

export function appendModelEventAudit(
  projectDir: string,
  input: {
    event: unknown;
    selections?: AgentModelSelectionFromEvent[];
  },
): void {
  const eventType =
    input.event && typeof input.event === 'object'
      ? String((input.event as { type?: unknown }).type ?? '')
      : '';
  const payload = {
    id: `mevt_${randomUUID()}`,
    at: new Date().toISOString(),
    pid: process.pid,
    eventType,
    extractedSelectionCount: Array.isArray(input.selections)
      ? input.selections.length
      : 0,
    extractedSelections: sanitizeForAudit(input.selections ?? []),
    event: sanitizeForAudit(input.event),
  };
  for (const file of auditFiles(projectDir)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateAuditFile(file);
    fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, 'utf-8');
  }
}
