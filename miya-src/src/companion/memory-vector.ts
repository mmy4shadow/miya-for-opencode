import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { syncCompanionMemoriesToSqlite } from './memory-sqlite';

export interface CompanionMemoryVector {
  id: string;
  text: string;
  source: string;
  embedding: number[];
  score: number;
  confidence: number;
  tier: 'L1' | 'L2' | 'L3';
  sourceMessageID?: string;
  sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
  status: 'pending' | 'active' | 'superseded';
  conflictKey?: string;
  conflictWizardID?: string;
  supersededBy?: string;
  accessCount: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

interface MemoryVectorStore {
  version: 1;
  items: CompanionMemoryVector[];
}

export interface CompanionMemoryCorrection {
  id: string;
  conflictKey: string;
  candidateMemoryID: string;
  existingMemoryIDs: string[];
  status: 'pending' | 'resolved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

interface MemoryCorrectionStore {
  version: 1;
  items: CompanionMemoryCorrection[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'companion-memory-vectors.json');
}

function correctionFilePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'companion-memory-corrections.json');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(path.dirname(filePath(projectDir)), { recursive: true });
}

function readStore(projectDir: string): MemoryVectorStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return { version: 1, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MemoryVectorStore>;
    return {
      version: 1,
      items: Array.isArray(parsed.items)
        ? parsed.items.map((item) => ({
            ...item,
            confidence:
              typeof item.confidence === 'number' && Number.isFinite(item.confidence)
                ? Math.max(0, Math.min(1, item.confidence))
                : 0.7,
            tier: item.tier === 'L1' || item.tier === 'L2' || item.tier === 'L3' ? item.tier : 'L2',
            sourceMessageID:
              typeof item.sourceMessageID === 'string' && item.sourceMessageID.trim()
                ? item.sourceMessageID
                : undefined,
            sourceType:
              item.sourceType === 'manual' ||
              item.sourceType === 'conversation' ||
              item.sourceType === 'reflect' ||
              item.sourceType === 'direct_correction'
                ? item.sourceType
                : 'manual',
            status:
              item.status === 'active' ||
              item.status === 'pending' ||
              item.status === 'superseded'
                ? item.status
                : 'active',
            accessCount:
              typeof item.accessCount === 'number' && Number.isFinite(item.accessCount)
                ? Math.max(0, Math.floor(item.accessCount))
                : 0,
            isArchived: typeof item.isArchived === 'boolean' ? item.isArchived : false,
          }))
        : [],
    };
  } catch {
    return { version: 1, items: [] };
  }
}

function readCorrectionStore(projectDir: string): MemoryCorrectionStore {
  const file = correctionFilePath(projectDir);
  if (!fs.existsSync(file)) return { version: 1, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MemoryCorrectionStore>;
    return {
      version: 1,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeCorrectionStore(
  projectDir: string,
  store: MemoryCorrectionStore,
): MemoryCorrectionStore {
  ensureDir(projectDir);
  fs.writeFileSync(correctionFilePath(projectDir), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  return store;
}

function writeStore(projectDir: string, store: MemoryVectorStore): MemoryVectorStore {
  ensureDir(projectDir);
  fs.writeFileSync(filePath(projectDir), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  syncCompanionMemoriesToSqlite(projectDir, store.items);
  return store;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function textToEmbedding(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  const parts = normalizeText(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length === 0) return vec;
  for (const part of parts) {
    const hash = createHash('sha256').update(part).digest();
    for (let i = 0; i < 8; i += 1) {
      const idx = hash[i] % dims;
      vec[idx] += 1 + (hash[i + 8] % 3);
    }
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (norm <= 0) return vec;
  return vec.map((value) => value / norm);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function extractConflictKey(text: string): { key?: string; polarity: 'positive' | 'negative' | 'neutral' } {
  const negative = text.match(/(?:不喜欢|讨厌|不想|不要)\s*([^，。!！?？]+)/);
  if (negative?.[1]) return { key: normalizeText(negative[1]), polarity: 'negative' };
  const positive = text.match(/(?:喜欢|爱|偏好|想要)\s*([^，。!！?？]+)/);
  if (positive?.[1]) return { key: normalizeText(positive[1]), polarity: 'positive' };
  return { polarity: 'neutral' };
}

export function decayCompanionMemoryVectors(
  projectDir: string,
  halfLifeDays = 30,
): { updated: number; items: CompanionMemoryVector[] } {
  const store = readStore(projectDir);
  const safeHalfLife = Math.max(1, halfLifeDays);
  const lambda = Math.log(2) / safeHalfLife;
  const nowMs = Date.now();
  let updated = 0;
  for (const item of store.items) {
    if (item.status !== 'active') continue;
    const ageDays = Math.max(0, (nowMs - Date.parse(item.updatedAt)) / (24 * 3600 * 1000));
    const nextScore = Math.max(0.05, item.score * Math.exp(-lambda * ageDays));
    if (Math.abs(nextScore - item.score) > 0.0001) {
      item.score = Number(nextScore.toFixed(4));
      if (item.score < 0.08) {
        item.isArchived = true;
      }
      item.updatedAt = nowIso();
      updated += 1;
    }
  }
  writeStore(projectDir, store);
  return { updated, items: store.items };
}

export function upsertCompanionMemoryVector(
  projectDir: string,
  input: {
    text: string;
    source?: string;
    activate?: boolean;
    confidence?: number;
    tier?: 'L1' | 'L2' | 'L3';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
  },
): CompanionMemoryVector {
  const text = normalizeText(input.text);
  if (!text) throw new Error('invalid_memory_text');

  decayCompanionMemoryVectors(projectDir);
  const store = readStore(projectDir);
  const embedding = textToEmbedding(text);
  const now = nowIso();

  const near = store.items
    .filter((item) => item.status === 'active')
    .map((item) => ({
      item,
      sim: cosine(item.embedding, embedding),
    }))
    .sort((a, b) => b.sim - a.sim)[0];
  if (near && near.sim >= 0.95) {
    near.item.score = Math.min(1.5, near.item.score + 0.15);
    near.item.accessCount += 1;
    near.item.isArchived = false;
    near.item.lastAccessedAt = now;
    near.item.updatedAt = now;
    writeStore(projectDir, store);
    return near.item;
  }

  const preference = extractConflictKey(text);
  const confidenceInput =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? input.confidence
      : input.tier === 'L1'
        ? 1
        : input.tier === 'L3'
          ? 0.4
          : 0.7;
  const confidence = Math.max(0, Math.min(1, confidenceInput));

  const created: CompanionMemoryVector = {
    id: `mem_${randomUUID()}`,
    text,
    source: input.source?.trim() || 'manual',
    embedding,
    score: 1,
    confidence,
    tier: input.tier ?? (confidence >= 0.95 ? 'L1' : confidence >= 0.6 ? 'L2' : 'L3'),
    sourceMessageID: input.sourceMessageID,
    sourceType: input.sourceType ?? 'manual',
    status: input.activate ? 'active' : 'pending',
    conflictKey: preference.key,
    accessCount: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  };

  if (preference.key && preference.polarity !== 'neutral') {
    const conflicting: CompanionMemoryVector[] = [];
    for (const item of store.items) {
      if (item.status === 'superseded') continue;
      const other = extractConflictKey(item.text);
      if (!other.key || other.key !== preference.key || other.polarity === 'neutral') continue;
      if (other.polarity !== preference.polarity) {
        conflicting.push(item);
      }
    }
    if (conflicting.length > 0) {
      const lambda = Math.log(2) / 30;
      const newScore = created.confidence;
      const scored = conflicting.map((item) => {
        const ageDays = Math.max(0, (Date.now() - Date.parse(item.lastAccessedAt)) / (24 * 3600 * 1000));
        const score = item.confidence * Math.exp(-lambda * ageDays);
        return { item, score };
      });
      const strongestOld = scored.sort((a, b) => b.score - a.score)[0];
      const threshold = 0.1;
      const forceOverride = created.sourceType === 'direct_correction';
      const shouldOverwrite =
        forceOverride || (strongestOld ? newScore > strongestOld.score + threshold : false);

      if (shouldOverwrite) {
        created.status = 'active';
        for (const other of conflicting) {
          other.status = 'superseded';
          other.supersededBy = created.id;
          other.updatedAt = now;
        }
      } else {
        const correctionStore = readCorrectionStore(projectDir);
        const wizard: CompanionMemoryCorrection = {
          id: `mcw_${randomUUID()}`,
          conflictKey: preference.key,
          candidateMemoryID: created.id,
          existingMemoryIDs: conflicting.map((item) => item.id),
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        correctionStore.items = [wizard, ...correctionStore.items].slice(0, 1000);
        writeCorrectionStore(projectDir, correctionStore);
        created.conflictWizardID = wizard.id;
        created.status = 'pending';
      }
    }
  }

  store.items = [created, ...store.items].slice(0, 1000);
  writeStore(projectDir, store);
  return created;
}

export function searchCompanionMemoryVectors(
  projectDir: string,
  query: string,
  limit = 5,
  options?: {
    threshold?: number;
    recencyHalfLifeDays?: number;
    alpha?: number;
    beta?: number;
    gamma?: number;
  },
): Array<CompanionMemoryVector & { similarity: number; rankScore: number }> {
  const q = normalizeText(query);
  if (!q) return [];
  const qEmb = textToEmbedding(q);
  const store = readStore(projectDir);
  const nowMs = Date.now();
  const recencyHalfLifeDays = Math.max(1, options?.recencyHalfLifeDays ?? 30);
  const alpha = options?.alpha ?? 0.6;
  const beta = options?.beta ?? 0.2;
  const gamma = options?.gamma ?? 0.2;
  const threshold = Math.max(0, options?.threshold ?? 0.15);

  const importanceFromTier = (tier: 'L1' | 'L2' | 'L3'): number =>
    tier === 'L1' ? 1 : tier === 'L2' ? 0.7 : 0.4;

  const recency = (at: string): number => {
    const deltaDays = Math.max(0, (nowMs - Date.parse(at)) / (24 * 3600 * 1000));
    const lambda = Math.log(2) / recencyHalfLifeDays;
    return Math.exp(-lambda * deltaDays);
  };

  const results = store.items
    .filter((item) => item.status === 'active' && !item.isArchived)
    .map((item) => {
      const similarity = cosine(item.embedding, qEmb);
      const importance = importanceFromTier(item.tier) * item.score * item.confidence;
      const rankScore = alpha * similarity + beta * recency(item.lastAccessedAt) + gamma * importance;
      return { ...item, similarity, rankScore };
    })
    .filter((item) => item.rankScore >= threshold)
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, Math.max(1, limit));
  for (const item of results) {
    const target = store.items.find((existing) => existing.id === item.id);
    if (!target) continue;
    target.accessCount += 1;
    target.lastAccessedAt = nowIso();
  }
  writeStore(projectDir, store);
  return results;
}

export function listCompanionMemoryVectors(projectDir: string): CompanionMemoryVector[] {
  return readStore(projectDir).items;
}

export function listPendingCompanionMemoryVectors(
  projectDir: string,
): CompanionMemoryVector[] {
  return readStore(projectDir).items.filter((item) => item.status === 'pending');
}

export function listCompanionMemoryCorrections(
  projectDir: string,
): CompanionMemoryCorrection[] {
  return readCorrectionStore(projectDir).items;
}

export function confirmCompanionMemoryVector(
  projectDir: string,
  input: {
    memoryID: string;
    confirm: boolean;
    supersedeConflicts?: boolean;
  },
): CompanionMemoryVector | null {
  const store = readStore(projectDir);
  const target = store.items.find((item) => item.id === input.memoryID);
  if (!target) return null;

  const now = nowIso();
  if (!input.confirm) {
    target.status = 'superseded';
    target.updatedAt = now;
  } else {
    target.status = 'active';
    target.updatedAt = now;
    target.lastAccessedAt = now;
    if (input.supersedeConflicts && target.conflictKey) {
      for (const item of store.items) {
        if (item.id === target.id || item.status === 'superseded') continue;
        if (item.conflictKey === target.conflictKey) {
          const sourcePolarity = extractConflictKey(target.text).polarity;
          const itemPolarity = extractConflictKey(item.text).polarity;
          if (sourcePolarity !== 'neutral' && itemPolarity !== 'neutral' && sourcePolarity !== itemPolarity) {
            item.status = 'superseded';
            item.supersededBy = target.id;
            item.updatedAt = now;
          }
        }
      }
    }
  }
  writeStore(projectDir, store);

  if (target.conflictWizardID) {
    const corrections = readCorrectionStore(projectDir);
    corrections.items = corrections.items.map((item) =>
      item.id === target.conflictWizardID
        ? {
            ...item,
            status: input.confirm ? 'resolved' : 'rejected',
            updatedAt: now,
          }
        : item,
    );
    writeCorrectionStore(projectDir, corrections);
  }
  return target;
}
