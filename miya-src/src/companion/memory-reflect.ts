import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createSkillDraftsFromReflect } from '../learning';
import { getMiyaRuntimeDir } from '../workflow';
import {
  appendMemoryEvent,
  appendRawMemoryLog,
  constructReflectBatch,
  listRawMemoryLogs,
} from './memory-sqlite';
import type {
  CompanionMemoryVector,
  MemoryQuoteSpan,
  MemoryShortTermLog,
} from './memory-types';

interface ReflectTriplet {
  kind: 'Fact' | 'Insight' | 'UserPreference';
  subject: 'User' | 'Miya';
  predicate: string;
  object: string;
  confidence: number;
  tier: 'L0' | 'L1' | 'L2';
  domain: 'work' | 'relationship' | 'personal' | 'system';
  sourceLogID: string;
  quotes: MemoryQuoteSpan[];
}

export interface ReflectResult {
  jobID: string;
  processedLogs: number;
  generatedTriplets: number;
  generatedFacts: number;
  generatedInsights: number;
  generatedPreferences: number;
  createdMemories: CompanionMemoryVector[];
  archivedLogs: number;
  auditID: string;
}

interface ReflectState {
  lastLogAt?: string;
  lastReflectAt?: string;
  lastReflectIdempotencyKey?: string;
  lastReflectResult?: ReflectResult;
  lastReflectReason?: string;
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

function hashMessage(input: {
  text: string;
  sender: string;
  at: string;
}): string {
  return createHash('sha256')
    .update(`${input.sender}\n${input.at}\n${normalizeText(input.text)}`)
    .digest('hex');
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

function writeReflectState(
  projectDir: string,
  patch: Partial<ReflectState>,
): ReflectState {
  ensureDir(projectDir);
  const file = reflectStatePath(projectDir);
  const next: ReflectState = {
    ...readReflectState(projectDir),
    ...patch,
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

function quoteSpan(
  log: MemoryShortTermLog,
  raw: string,
): MemoryQuoteSpan | null {
  const value = normalizeText(raw);
  if (!value) return null;
  const start = log.text.indexOf(value);
  if (start < 0) return null;
  return {
    logID: log.id,
    exactText: value,
    charStart: start,
    charEnd: start + value.length,
  };
}

function extractTriplets(log: MemoryShortTermLog): ReflectTriplet[] {
  if (log.sender === 'system') return [];
  const text = normalizeText(log.text);
  if (!text) return [];
  const triplets: ReflectTriplet[] = [];

  const add = (
    kind: 'Fact' | 'Insight' | 'UserPreference',
    subject: 'User' | 'Miya',
    predicate: string,
    object: string,
    confidence: number,
    tier: 'L0' | 'L1' | 'L2',
    quoteRaw: string,
  ) => {
    const value = normalizeText(object);
    const q = quoteSpan(log, quoteRaw);
    if (!value || !q) return;
    triplets.push({
      kind,
      subject,
      predicate,
      object: value,
      confidence,
      tier,
      sourceLogID: log.id,
      domain: 'work',
      quotes: [q],
    });
  };

  const likes = text.match(/我(?:特别)?喜欢([^，。！？!?.]+)/);
  if (likes?.[1])
    add('UserPreference', 'User', 'likes', likes[1], 0.86, 'L1', likes[0]);

  const dislikes = text.match(/我(?:很|真的)?不喜欢([^，。！？!?.]+)/);
  if (dislikes?.[1])
    add(
      'UserPreference',
      'User',
      'dislikes',
      dislikes[1],
      0.86,
      'L1',
      dislikes[0],
    );

  const prefers = text.match(
    /(?:以后|之后|从现在开始)?(?:只要|只喝|只用|优先)\s*([^，。！？!?.]+)/,
  );
  if (prefers?.[1])
    add('UserPreference', 'User', 'prefers', prefers[1], 0.9, 'L1', prefers[0]);

  const avoids = text.match(/(?:不要|别|避免)\s*([^，。！？!?.]+)/);
  if (avoids?.[1])
    add('UserPreference', 'User', 'avoids', avoids[1], 0.88, 'L1', avoids[0]);

  const needs = text.match(/我(?:需要|想要|要)([^，。！？!?.]+)/);
  if (needs?.[1])
    add('Fact', 'User', 'requires', needs[1], 0.7, 'L1', needs[0]);

  const blocks = text.match(
    /(?:卡在|被|遇到)([^，。！？!?.]+)(?:问题|错误|异常|报错)/,
  );
  if (blocks?.[1])
    add(
      'Insight',
      'User',
      'is_blocking',
      `${blocks[1]}问题`,
      0.75,
      'L2',
      blocks[0],
    );

  const anxiety = text.match(
    /(?:焦虑|着急|担心|压力很大|怕来不及)([^，。！？!?.]*)/,
  );
  if (anxiety)
    add(
      'Insight',
      'User',
      'emotion_signal',
      `进度压力 ${anxiety[0]}`.trim(),
      0.72,
      'L2',
      anxiety[0],
    );

  const project = text.match(
    /(?:项目|仓库|repo|分支)\s*[:：]?\s*([^，。！？!?.]+)/i,
  );
  if (project?.[1])
    add('Fact', 'User', 'project', project[1], 0.68, 'L1', project[0]);

  if (triplets.length === 0 && text.length <= 120) {
    add(
      'Fact',
      log.sender === 'assistant' ? 'Miya' : 'User',
      'stated',
      text,
      0.55,
      'L2',
      text,
    );
  }

  return triplets;
}

function validateTripletQuotes(
  triplet: ReflectTriplet,
  logsByID: Map<string, MemoryShortTermLog>,
): boolean {
  for (const quote of triplet.quotes) {
    const source = logsByID.get(quote.logID);
    if (!source) return false;
    if (quote.charStart < 0 || quote.charEnd <= quote.charStart) return false;
    const picked = source.text.slice(quote.charStart, quote.charEnd);
    if (normalizeText(picked) !== normalizeText(quote.exactText)) return false;
  }
  return true;
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
  const messageHash =
    input.messageID || hashMessage({ text, sender: input.sender, at });
  ensureDir(projectDir);

  const row: MemoryShortTermLog = {
    id: `st_${randomUUID()}`,
    sessionID: input.sessionID?.trim() || 'main',
    sender: input.sender,
    text,
    at,
    messageHash,
  };

  const saved = appendRawMemoryLog(projectDir, row);
  if (!saved) return null;

  appendMemoryEvent(projectDir, {
    eventID: `evt_${randomUUID()}`,
    eventType: 'raw_log_appended',
    entityType: 'raw_log',
    entityID: saved.id,
    payload: {
      sessionID: saved.sessionID,
      sender: saved.sender,
      at: saved.at,
    },
  });

  writeReflectState(projectDir, { lastLogAt: at });
  return saved;
}

export function getMemoryReflectStatus(projectDir: string): ReflectStatus {
  const pendingLogs = listRawMemoryLogs(projectDir, {
    pendingOnly: true,
    limit: 5000,
  }).length;
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
    idempotencyKey?: string;
    cooldownMinutes?: number;
    policyHash?: string;
  },
): ReflectResult {
  ensureDir(projectDir);
  const state = readReflectState(projectDir);
  const now = nowIso();

  if (
    input?.idempotencyKey &&
    state.lastReflectIdempotencyKey === input.idempotencyKey
  ) {
    if (state.lastReflectResult) return state.lastReflectResult;
  }

  const cooldownMinutes = Math.max(0, input?.cooldownMinutes ?? 0);
  if (cooldownMinutes > 0 && state.lastReflectAt) {
    const deltaMs = Date.now() - Date.parse(state.lastReflectAt);
    if (Number.isFinite(deltaMs) && deltaMs < cooldownMinutes * 60 * 1000) {
      const blocked: ReflectResult = {
        jobID: `reflect_${randomUUID()}`,
        processedLogs: 0,
        generatedTriplets: 0,
        generatedFacts: 0,
        generatedInsights: 0,
        generatedPreferences: 0,
        createdMemories: [],
        archivedLogs: 0,
        auditID: `audit_${randomUUID()}`,
      };
      writeReflectState(projectDir, {
        lastReflectReason: `cooldown_blocked_${cooldownMinutes}m`,
      });
      return blocked;
    }
  }

  const pending = listRawMemoryLogs(projectDir, {
    pendingOnly: true,
    limit: 2000,
  });
  const minLogs = Math.max(1, input?.minLogs ?? 1);
  if (!input?.force && pending.length < minLogs) {
    return {
      jobID: `reflect_${randomUUID()}`,
      processedLogs: 0,
      generatedTriplets: 0,
      generatedFacts: 0,
      generatedInsights: 0,
      generatedPreferences: 0,
      createdMemories: [],
      archivedLogs: 0,
      auditID: `audit_${randomUUID()}`,
    };
  }

  const maxLogs = Math.max(1, input?.maxLogs ?? 50);
  const picked = pending.slice(0, maxLogs);
  const logsByID = new Map(picked.map((row) => [row.id, row]));

  const extracted = picked.flatMap((row) => extractTriplets(row));
  const triplets = extracted.filter((item) =>
    validateTripletQuotes(item, logsByID),
  );

  const generatedFacts = triplets.filter((item) => item.kind === 'Fact').length;
  const generatedInsights = triplets.filter(
    (item) => item.kind === 'Insight',
  ).length;
  const generatedPreferences = triplets.filter(
    (item) => item.kind === 'UserPreference',
  ).length;

  const processedAt = nowIso();
  const jobID = `reflect_${randomUUID()}`;
  const auditID = `audit_${randomUUID()}`;

  const constructed = constructReflectBatch(projectDir, {
    jobID,
    auditID,
    processedAt,
    policyHash: input?.policyHash,
    pickedLogs: picked,
    triplets,
    evidenceMeta: {
      schema_version: 'EvidencePackV5',
      generated_at: processedAt,
      policy_hash: input?.policyHash ?? null,
      tool: 'miya.memory.reflect',
      job_id: jobID,
      source: 'memory_reflect',
    },
    evidencePayload: {
      logs: picked,
      extracted_triplets: triplets,
      dropped_triplets: extracted.length - triplets.length,
    },
    reflectStats: {
      generatedFacts,
      generatedInsights,
      generatedPreferences,
    },
  });
  const createdMemories = constructed.createdMemories;

  const result: ReflectResult = {
    jobID,
    processedLogs: picked.length,
    generatedTriplets: triplets.length,
    generatedFacts,
    generatedInsights,
    generatedPreferences,
    createdMemories,
    archivedLogs: constructed.processedLogs,
    auditID,
  };

  createSkillDraftsFromReflect(projectDir, {
    createdMemories,
  });

  fs.appendFileSync(
    reflectJobPath(projectDir),
    `${JSON.stringify({ ...result, at: processedAt })}\n`,
    'utf-8',
  );

  writeReflectState(projectDir, {
    lastReflectAt: now,
    lastReflectIdempotencyKey: input?.idempotencyKey,
    lastReflectResult: result,
    lastReflectReason: 'ok',
  });

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
    if (Number.isFinite(cooldownMs) && cooldownMs < cooldownMinutes * 60 * 1000)
      return null;
  }

  return reflectCompanionMemory(projectDir, {
    force: true,
    minLogs: minPendingLogs,
    maxLogs: input?.maxLogs ?? 50,
  });
}

export function maybeReflectOnSessionEnd(
  projectDir: string,
  input?: {
    minPendingLogs?: number;
    maxLogs?: number;
  },
): ReflectResult | null {
  const minPendingLogs = Math.max(1, input?.minPendingLogs ?? 50);
  const status = getMemoryReflectStatus(projectDir);
  if (status.pendingLogs < minPendingLogs) return null;
  return reflectCompanionMemory(projectDir, {
    force: true,
    minLogs: minPendingLogs,
    maxLogs: input?.maxLogs ?? 100,
  });
}
