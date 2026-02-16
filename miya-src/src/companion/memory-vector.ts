import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { syncCompanionMemoriesToSqlite } from './memory-sqlite';
import { embedTextWithProvider } from './memory-embedding';

export type MemoryDomain = 'work' | 'relationship';
export type MemorySemanticLayer = 'episodic' | 'semantic' | 'preference' | 'tool_trace';
export type MemoryLearningStage = 'ephemeral' | 'candidate' | 'persistent';

export interface CompanionMemoryVector {
  id: string;
  text: string;
  domain: MemoryDomain;
  inferredDomain?: MemoryDomain;
  crossDomainWrite?: {
    from: MemoryDomain;
    to: MemoryDomain;
    requiresApproval: boolean;
    evidence: string[];
    approvedAt?: string;
  };
  memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
  semanticLayer: MemorySemanticLayer;
  learningStage: MemoryLearningStage;
  source: string;
  embeddingProvider: string;
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
  version: 2;
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

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeSemanticLayer(
  value: unknown,
  fallback: MemorySemanticLayer,
): MemorySemanticLayer {
  if (
    value === 'episodic' ||
    value === 'semantic' ||
    value === 'preference' ||
    value === 'tool_trace'
  ) {
    return value;
  }
  return fallback;
}

function normalizeLearningStage(
  value: unknown,
  fallback: MemoryLearningStage,
): MemoryLearningStage {
  if (value === 'ephemeral' || value === 'candidate' || value === 'persistent') {
    return value;
  }
  return fallback;
}

const WORK_DOMAIN_HINT =
  /(bug|fix|error|code|commit|branch|build|deploy|api|test|typescript|python|sql|修复|报错|代码|编译|部署|接口|脚本|函数|测试)/i;

function inferSemanticLayerByText(
  text: string,
  kind?: CompanionMemoryVector['memoryKind'],
  sourceType?: CompanionMemoryVector['sourceType'],
): MemorySemanticLayer {
  if (kind === 'UserPreference') return 'preference';
  if (sourceType === 'reflect' && /(trace|stack|command|tool|shell|stderr|stdout|日志|报错)/i.test(text)) {
    return 'tool_trace';
  }
  if (kind === 'Insight') return 'semantic';
  if (/(喜欢|不喜欢|偏好|prefer|avoid|爱|讨厌)/i.test(text)) return 'preference';
  if (/(策略|原则|规则|习惯|tends to|usually|always|often)/i.test(text)) return 'semantic';
  if (/(trace|stack|command|tool|shell|stderr|stdout|日志|报错|执行了)/i.test(text)) {
    return 'tool_trace';
  }
  return 'episodic';
}

function inferLearningStageByStatus(
  status: CompanionMemoryVector['status'],
): MemoryLearningStage {
  if (status === 'active') return 'persistent';
  if (status === 'pending') return 'candidate';
  return 'candidate';
}

export function inferMemoryDomain(text: string): MemoryDomain {
  return WORK_DOMAIN_HINT.test(text) ? 'work' : 'relationship';
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function lexicalSimilarity(queryTokens: string[], docTokens: string[], docFreq: Map<string, number>, corpusSize: number): number {
  if (queryTokens.length === 0 || docTokens.length === 0 || corpusSize <= 0) return 0;
  const tf = new Map<string, number>();
  for (const token of docTokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  let score = 0;
  for (const token of queryTokens) {
    const termFreq = (tf.get(token) ?? 0) / docTokens.length;
    if (termFreq <= 0) continue;
    const df = docFreq.get(token) ?? 0;
    const idf = Math.log((corpusSize + 1) / (df + 1)) + 1;
    score += termFreq * idf;
  }
  return score;
}

function buildDocFreq(tokensList: string[][]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const tokens of tokensList) {
    const uniq = new Set(tokens);
    for (const token of uniq) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }
  return freq;
}

function extractConflictKey(text: string): { key?: string; polarity: 'positive' | 'negative' | 'neutral' } {
  const negative = text.match(/(?:不喜欢|讨厌|不想|不要)\s*([^，。!！?？]+)/);
  if (negative?.[1]) return { key: normalizeText(negative[1]), polarity: 'negative' };
  const positive = text.match(/(?:喜欢|爱|偏好|想要)\s*([^，。!！?？]+)/);
  if (positive?.[1]) return { key: normalizeText(positive[1]), polarity: 'positive' };
  return { polarity: 'neutral' };
}

function readStore(projectDir: string): MemoryVectorStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return { version: 2, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MemoryVectorStore>;
    return {
      version: 2,
      items: Array.isArray(parsed.items)
        ? parsed.items.map((item) => {
            const status: CompanionMemoryVector['status'] =
              item.status === 'active' || item.status === 'pending' || item.status === 'superseded'
                ? item.status
                : 'active';
            const memoryKind: CompanionMemoryVector['memoryKind'] =
              item.memoryKind === 'Fact' ||
              item.memoryKind === 'Insight' ||
              item.memoryKind === 'UserPreference'
                ? item.memoryKind
                : undefined;
            const sourceType: CompanionMemoryVector['sourceType'] =
              item.sourceType === 'manual' ||
              item.sourceType === 'conversation' ||
              item.sourceType === 'reflect' ||
              item.sourceType === 'direct_correction'
                ? item.sourceType
                : 'manual';
            const text = typeof item.text === 'string' ? item.text : '';
            return {
              ...item,
              confidence:
                typeof item.confidence === 'number' && Number.isFinite(item.confidence)
                  ? Math.max(0, Math.min(1, item.confidence))
                  : 0.7,
              tier:
                item.tier === 'L1' || item.tier === 'L2' || item.tier === 'L3' ? item.tier : 'L2',
              sourceMessageID:
                typeof item.sourceMessageID === 'string' && item.sourceMessageID.trim()
                  ? item.sourceMessageID
                  : undefined,
              sourceType,
              memoryKind,
              semanticLayer: normalizeSemanticLayer(
                item.semanticLayer,
                inferSemanticLayerByText(text, memoryKind, sourceType),
              ),
              learningStage: normalizeLearningStage(
                item.learningStage,
                inferLearningStageByStatus(status),
              ),
              domain:
                item.domain === 'work' || item.domain === 'relationship'
                  ? item.domain
                  : 'relationship',
              inferredDomain:
                item.inferredDomain === 'work' || item.inferredDomain === 'relationship'
                  ? item.inferredDomain
                  : undefined,
              crossDomainWrite:
                item.crossDomainWrite &&
                typeof item.crossDomainWrite === 'object' &&
                (item.crossDomainWrite.from === 'work' ||
                  item.crossDomainWrite.from === 'relationship') &&
                (item.crossDomainWrite.to === 'work' ||
                  item.crossDomainWrite.to === 'relationship')
                  ? {
                      from: item.crossDomainWrite.from,
                      to: item.crossDomainWrite.to,
                      requiresApproval: item.crossDomainWrite.requiresApproval !== false,
                      evidence: Array.isArray(item.crossDomainWrite.evidence)
                        ? item.crossDomainWrite.evidence.map((entry) => String(entry)).slice(0, 20)
                        : [],
                      approvedAt:
                        typeof item.crossDomainWrite.approvedAt === 'string'
                          ? item.crossDomainWrite.approvedAt
                          : undefined,
                    }
                  : undefined,
              status,
              accessCount:
                typeof item.accessCount === 'number' && Number.isFinite(item.accessCount)
                  ? Math.max(0, Math.floor(item.accessCount))
                  : 0,
              embeddingProvider:
                typeof item.embeddingProvider === 'string' && item.embeddingProvider.trim()
                  ? item.embeddingProvider
                  : 'local-hash',
              isArchived: typeof item.isArchived === 'boolean' ? item.isArchived : false,
            } as CompanionMemoryVector;
          })
        : [],
    };
  } catch {
    return { version: 2, items: [] };
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
    domain?: MemoryDomain;
    source?: string;
    activate?: boolean;
    evidence?: string[];
    confidence?: number;
    tier?: 'L1' | 'L2' | 'L3';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    semanticLayer?: MemorySemanticLayer;
    learningStage?: MemoryLearningStage;
  },
): CompanionMemoryVector {
  const text = normalizeText(input.text);
  if (!text) throw new Error('invalid_memory_text');

  decayCompanionMemoryVectors(projectDir);
  const store = readStore(projectDir);
  const embedded = embedTextWithProvider(projectDir, text);
  const embedding = embedded.embedding;
  const now = nowIso();
  const inferredDomain = inferMemoryDomain(text);
  const requestedDomain = input.domain ?? inferredDomain;
  const crossDomain = requestedDomain !== inferredDomain;
  const crossDomainEvidence = Array.isArray(input.evidence)
    ? input.evidence.map((item) => normalizeText(String(item))).filter(Boolean).slice(0, 20)
    : [];

  const near = store.items
    .filter((item) => item.status === 'active' && item.domain === requestedDomain)
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
  const sourceType = input.sourceType ?? 'manual';
  const memoryKind = input.memoryKind;
  const defaultStatus: CompanionMemoryVector['status'] =
    crossDomain ? 'pending' : input.activate ? 'active' : 'pending';
  const semanticLayer = normalizeSemanticLayer(
    input.semanticLayer,
    inferSemanticLayerByText(text, memoryKind, sourceType),
  );

  const created: CompanionMemoryVector = {
    id: `mem_${randomUUID()}`,
    text,
    domain: requestedDomain,
    inferredDomain,
    crossDomainWrite: crossDomain
      ? {
          from: inferredDomain,
          to: requestedDomain,
          requiresApproval: true,
          evidence: crossDomainEvidence,
        }
      : undefined,
    source: input.source?.trim() || 'manual',
    embeddingProvider: embedded.provider,
    embedding,
    score: 1,
    confidence,
    tier: input.tier ?? (confidence >= 0.95 ? 'L1' : confidence >= 0.6 ? 'L2' : 'L3'),
    sourceMessageID: input.sourceMessageID,
    sourceType,
    memoryKind,
    semanticLayer,
    learningStage: normalizeLearningStage(
      input.learningStage,
      inferLearningStageByStatus(defaultStatus),
    ),
    status: defaultStatus,
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

      if (shouldOverwrite && !crossDomain) {
        created.status = 'active';
        created.learningStage = 'persistent';
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
        created.learningStage = 'candidate';
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
    domain?: MemoryDomain;
    domains?: MemoryDomain[];
    semanticWeight?: number;
    lexicalWeight?: number;
    semanticLayers?: MemorySemanticLayer[];
    learningStages?: MemoryLearningStage[];
  },
): Array<
  CompanionMemoryVector & {
    similarity: number;
    semanticSimilarity: number;
    lexicalSimilarity: number;
    rankScore: number;
    channels: { semantic: number; lexical: number };
  }
> {
  const q = normalizeText(query);
  if (!q) return [];
  const embeddedQuery = embedTextWithProvider(projectDir, q);
  const qEmb = embeddedQuery.embedding;
  const qTokens = tokenize(q);
  const store = readStore(projectDir);
  const nowMs = Date.now();
  const recencyHalfLifeDays = Math.max(1, options?.recencyHalfLifeDays ?? 30);
  const alpha = options?.alpha ?? 0.6;
  const beta = options?.beta ?? 0.2;
  const gamma = options?.gamma ?? 0.2;
  const threshold = Math.max(0, options?.threshold ?? 0.15);
  const semanticWeight = Math.max(0, options?.semanticWeight ?? 0.7);
  const lexicalWeight = Math.max(0, options?.lexicalWeight ?? 0.3);
  const combinedWeightBase = Math.max(0.001, semanticWeight + lexicalWeight);
  const domainAllow = new Set<MemoryDomain>();
  if (options?.domain === 'work' || options?.domain === 'relationship') {
    domainAllow.add(options.domain);
  }
  if (Array.isArray(options?.domains)) {
    for (const item of options.domains) {
      if (item === 'work' || item === 'relationship') domainAllow.add(item);
    }
  }

  const semanticLayerAllow = new Set<MemorySemanticLayer>();
  if (Array.isArray(options?.semanticLayers)) {
    for (const layer of options.semanticLayers) {
      if (layer === 'episodic' || layer === 'semantic' || layer === 'preference' || layer === 'tool_trace') {
        semanticLayerAllow.add(layer);
      }
    }
  }

  const learningStageAllow = new Set<MemoryLearningStage>();
  if (Array.isArray(options?.learningStages)) {
    for (const stage of options.learningStages) {
      if (stage === 'ephemeral' || stage === 'candidate' || stage === 'persistent') {
        learningStageAllow.add(stage);
      }
    }
  }

  const importanceFromTier = (tier: 'L1' | 'L2' | 'L3'): number =>
    tier === 'L1' ? 1 : tier === 'L2' ? 0.7 : 0.4;

  const recency = (at: string): number => {
    const deltaDays = Math.max(0, (nowMs - Date.parse(at)) / (24 * 3600 * 1000));
    const lambda = Math.log(2) / recencyHalfLifeDays;
    return Math.exp(-lambda * deltaDays);
  };

  const candidates = store.items.filter((item) => {
    if (item.status !== 'active' || item.isArchived) return false;
    if (domainAllow.size > 0 && !domainAllow.has(item.domain)) return false;
    if (semanticLayerAllow.size > 0 && !semanticLayerAllow.has(item.semanticLayer)) return false;
    if (learningStageAllow.size > 0 && !learningStageAllow.has(item.learningStage)) return false;
    return true;
  });

  const tokenizedDocs = candidates.map((item) => tokenize(item.text));
  const docFreq = buildDocFreq(tokenizedDocs);

  const results = candidates
    .map((item, index) => {
      const semanticSimilarity = cosine(item.embedding, qEmb);
      const lexicalRaw = lexicalSimilarity(qTokens, tokenizedDocs[index] ?? [], docFreq, Math.max(1, candidates.length));
      const lexicalSimilarityNorm = Math.max(0, Math.min(1, lexicalRaw / 3));
      const similarity =
        (semanticSimilarity * semanticWeight + lexicalSimilarityNorm * lexicalWeight) /
        combinedWeightBase;
      const importance = importanceFromTier(item.tier) * item.score * item.confidence;
      const rankScore = alpha * similarity + beta * recency(item.lastAccessedAt) + gamma * importance;
      return {
        ...item,
        similarity,
        semanticSimilarity,
        lexicalSimilarity: lexicalSimilarityNorm,
        channels: {
          semantic: semanticSimilarity,
          lexical: lexicalSimilarityNorm,
        },
        rankScore,
      };
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

export function listCompanionMemoryVectors(
  projectDir: string,
  domain?: MemoryDomain,
): CompanionMemoryVector[] {
  return readStore(projectDir).items.filter((item) => !domain || item.domain === domain);
}

export function listPendingCompanionMemoryVectors(
  projectDir: string,
  domain?: MemoryDomain,
): CompanionMemoryVector[] {
  return readStore(projectDir).items.filter(
    (item) => item.status === 'pending' && (!domain || item.domain === domain),
  );
}

export function listCompanionMemoryCorrections(
  projectDir: string,
): CompanionMemoryCorrection[] {
  return readCorrectionStore(projectDir).items;
}

export function mergePendingMemoryConflicts(
  projectDir: string,
  input?: { maxSupersede?: number },
): { merged: number; winners: string[] } {
  const store = readStore(projectDir);
  const maxSupersede = Math.max(1, Math.min(200, Math.floor(input?.maxSupersede ?? 40)));
  const now = nowIso();
  const groups = new Map<string, CompanionMemoryVector[]>();
  for (const item of store.items) {
    if (item.status !== 'pending') continue;
    const conflict = extractConflictKey(item.text);
    if (!item.conflictKey || conflict.polarity === 'neutral') continue;
    const key = `${item.domain}|${item.conflictKey}|${conflict.polarity}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  let merged = 0;
  const winners: string[] = [];
  for (const [, group] of groups.entries()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    const winner = sorted[0];
    if (!winner) continue;
    winners.push(winner.id);
    for (const item of sorted.slice(1)) {
      if (merged >= maxSupersede) break;
      item.status = 'superseded';
      item.supersededBy = winner.id;
      item.updatedAt = now;
      merged += 1;
    }
    if (merged >= maxSupersede) break;
  }
  if (merged > 0) writeStore(projectDir, store);
  return { merged, winners };
}

export function confirmCompanionMemoryVector(
  projectDir: string,
  input: {
    memoryID: string;
    confirm: boolean;
    supersedeConflicts?: boolean;
    evidence?: string[];
  },
): CompanionMemoryVector | null {
  const store = readStore(projectDir);
  const target = store.items.find((item) => item.id === input.memoryID);
  if (!target) return null;

  const now = nowIso();
  if (!input.confirm) {
    target.status = 'superseded';
    target.learningStage = 'candidate';
    target.updatedAt = now;
  } else {
    if (target.crossDomainWrite?.requiresApproval) {
      const evidence = Array.isArray(input.evidence)
        ? input.evidence.map((item) => normalizeText(String(item))).filter(Boolean)
        : [];
      if (evidence.length === 0) {
        throw new Error('cross_domain_evidence_required');
      }
      target.crossDomainWrite = {
        ...target.crossDomainWrite,
        requiresApproval: false,
        evidence: Array.from(new Set([...target.crossDomainWrite.evidence, ...evidence])).slice(0, 30),
        approvedAt: now,
      };
    }
    target.status = 'active';
    target.learningStage = 'persistent';
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

export function getCompanionMemoryVector(
  projectDir: string,
  memoryID: string,
): CompanionMemoryVector | null {
  return readStore(projectDir).items.find((item) => item.id === memoryID) ?? null;
}
