import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { upsertCompanionMemoryVector, type CompanionMemoryVector } from './memory-vector';

export interface MemoryShortTermLog {
  id: string;
  sessionID: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  at: string;
  messageHash: string;
  processedAt?: string;
}

interface ReflectTriplet {
  subject: 'User' | 'Miya';
  predicate: string;
  object: string;
  confidence: number;
  tier: 'L1' | 'L2' | 'L3';
  sourceLogID: string;
}

export interface ReflectResult {
  jobID: string;
  processedLogs: number;
  generatedTriplets: number;
  createdMemories: CompanionMemoryVector[];
  archivedLogs: number;
}

interface ReflectState {
  lastLogAt?: string;
  lastReflectAt?: string;
}

export interface ReflectStatus {
  pendingLogs: number;
  lastLogAt?: string;
  lastReflectAt?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function memoryDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'memory');
}

function shortTermLogPath(projectDir: string): string {
  return path.join(memoryDir(projectDir), 'short-term-history.jsonl');
}

function archiveLogPath(projectDir: string): string {
  return path.join(memoryDir(projectDir), 'archived-history.jsonl');
}

function reflectJobPath(projectDir: string): string {
  return path.join(memoryDir(projectDir), 'reflect-jobs.jsonl');
}

function reflectStatePath(projectDir: string): string {
  return path.join(memoryDir(projectDir), 'reflect-state.json');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(memoryDir(projectDir), { recursive: true });
}

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function hashMessage(input: { text: string; sender: string; at: string }): string {
  return createHash('sha256')
    .update(`${input.sender}\n${input.at}\n${normalizeText(input.text)}`)
    .digest('hex');
}

function parseJsonlRows<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const rows: T[] = [];
  const raw = fs.readFileSync(file, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // Ignore malformed lines to keep reflect job resilient.
    }
  }
  return rows;
}

function writeJsonlRows<T>(file: string, rows: T[]): void {
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(file, body ? `${body}\n` : '', 'utf-8');
}

function readReflectState(projectDir: string): ReflectState {
  const file = reflectStatePath(projectDir);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as ReflectState;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeReflectState(projectDir: string, patch: Partial<ReflectState>): ReflectState {
  ensureDir(projectDir);
  const file = reflectStatePath(projectDir);
  const next: ReflectState = {
    ...readReflectState(projectDir),
    ...patch,
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

function extractTriplets(log: MemoryShortTermLog): ReflectTriplet[] {
  if (log.sender !== 'user') return [];
  const text = normalizeText(log.text);
  if (!text) return [];
  const triplets: ReflectTriplet[] = [];

  const add = (predicate: string, object: string, confidence: number, tier: 'L1' | 'L2' | 'L3') => {
    const value = normalizeText(object);
    if (!value) return;
    triplets.push({
      subject: 'User',
      predicate,
      object: value,
      confidence,
      tier,
      sourceLogID: log.id,
    });
  };

  const likes = text.match(/我(?:特别)?喜欢([^，。！？!?.]+)/);
  if (likes?.[1]) add('likes', likes[1], 0.82, 'L2');

  const dislikes = text.match(/我(?:很|真的)?不喜欢([^，。！？!?.]+)/);
  if (dislikes?.[1]) add('dislikes', dislikes[1], 0.82, 'L2');

  const needs = text.match(/我(?:需要|想要|要)([^，。！？!?.]+)/);
  if (needs?.[1]) add('requires', needs[1], 0.68, 'L2');

  const blocks = text.match(/(?:卡在|被|遇到)([^，。！？!?.]+)(?:问题|错误|异常|报错)/);
  if (blocks?.[1]) add('is_blocking', `${blocks[1]}问题`, 0.7, 'L2');

  const project = text.match(/(?:项目|仓库|repo|分支)\s*[:：]?\s*([^，。！？!?.]+)/i);
  if (project?.[1]) add('project', project[1], 0.65, 'L2');

  return triplets;
}

function tripletText(triplet: ReflectTriplet): string {
  return `${triplet.subject} ${triplet.predicate} ${triplet.object}`;
}

export function appendShortTermMemoryLog(
  projectDir: string,
  input: {
    sessionID?: string;
    sender: 'user' | 'assistant' | 'system';
    text: string;
    at?: string;
    messageID?: string;
  },
): MemoryShortTermLog | null {
  const text = normalizeText(input.text);
  if (!text) return null;
  const at = input.at ?? nowIso();
  const messageHash = input.messageID || hashMessage({ text, sender: input.sender, at });
  ensureDir(projectDir);
  const file = shortTermLogPath(projectDir);
  const rows = parseJsonlRows<MemoryShortTermLog>(file);
  if (rows.some((row) => row.messageHash === messageHash)) return null;
  const row: MemoryShortTermLog = {
    id: `st_${randomUUID()}`,
    sessionID: input.sessionID?.trim() || 'main',
    sender: input.sender,
    text,
    at,
    messageHash,
  };
  rows.push(row);
  writeJsonlRows(file, rows);
  writeReflectState(projectDir, { lastLogAt: at });
  return row;
}

export function getMemoryReflectStatus(projectDir: string): ReflectStatus {
  const rows = parseJsonlRows<MemoryShortTermLog>(shortTermLogPath(projectDir));
  const pendingLogs = rows.filter((row) => !row.processedAt).length;
  const state = readReflectState(projectDir);
  return {
    pendingLogs,
    lastLogAt: state.lastLogAt,
    lastReflectAt: state.lastReflectAt,
  };
}

export function reflectCompanionMemory(
  projectDir: string,
  input?: {
    force?: boolean;
    minLogs?: number;
    maxLogs?: number;
  },
): ReflectResult {
  ensureDir(projectDir);
  const rows = parseJsonlRows<MemoryShortTermLog>(shortTermLogPath(projectDir));
  const pending = rows.filter((row) => !row.processedAt);
  const minLogs = Math.max(1, input?.minLogs ?? 1);
  if (!input?.force && pending.length < minLogs) {
    return {
      jobID: `reflect_${randomUUID()}`,
      processedLogs: 0,
      generatedTriplets: 0,
      createdMemories: [],
      archivedLogs: 0,
    };
  }

  const maxLogs = Math.max(1, input?.maxLogs ?? 50);
  const picked = pending.slice(0, maxLogs);
  const triplets = picked.flatMap((row) => extractTriplets(row));
  const createdMemories = triplets.map((triplet) =>
    upsertCompanionMemoryVector(projectDir, {
      text: tripletText(triplet),
      source: 'reflect',
      activate: false,
      confidence: triplet.confidence,
      tier: triplet.tier,
      sourceMessageID: triplet.sourceLogID,
    }),
  );

  const processedAt = nowIso();
  const pickedIdSet = new Set(picked.map((row) => row.id));
  const nextRows = rows.filter((row) => !pickedIdSet.has(row.id));
  writeJsonlRows(shortTermLogPath(projectDir), nextRows);

  const archived = parseJsonlRows<MemoryShortTermLog>(archiveLogPath(projectDir));
  const moved = picked.map((row) => ({ ...row, processedAt }));
  writeJsonlRows(archiveLogPath(projectDir), [...archived, ...moved]);

  const result: ReflectResult = {
    jobID: `reflect_${randomUUID()}`,
    processedLogs: picked.length,
    generatedTriplets: triplets.length,
    createdMemories,
    archivedLogs: moved.length,
  };
  fs.appendFileSync(reflectJobPath(projectDir), `${JSON.stringify({ ...result, at: processedAt })}\n`, 'utf-8');
  writeReflectState(projectDir, { lastReflectAt: processedAt });
  return result;
}

export function maybeAutoReflectCompanionMemory(
  projectDir: string,
  input?: {
    idleMinutes?: number;
    minPendingLogs?: number;
    cooldownMinutes?: number;
    maxLogs?: number;
  },
): ReflectResult | null {
  const idleMinutes = Math.max(1, input?.idleMinutes ?? 10);
  const minPendingLogs = Math.max(1, input?.minPendingLogs ?? 50);
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

  return reflectCompanionMemory(projectDir, {
    force: true,
    minLogs: minPendingLogs,
    maxLogs: input?.maxLogs ?? 50,
  });
}
