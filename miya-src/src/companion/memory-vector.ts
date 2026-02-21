import { createHash, randomUUID } from 'node:crypto';
import {
  appendMemoryEvent,
  listMemoryCells,
  listMemoryCorrections,
  upsertMemoryCell,
  upsertMemoryCells,
  upsertMemoryCorrection,
} from './memory-sqlite';
import type {
  CompanionMemoryCorrection,
  CompanionMemoryVector,
} from './memory-types';

export type { CompanionMemoryVector } from './memory-types';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function textToEmbedding(text: string, dims = 96): number[] {
  const vec = new Array<number>(dims).fill(0);
  const parts = normalizeText(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (parts.length === 0) return vec;
  for (const part of parts) {
    const hash = createHash('sha256').update(part).digest();
    for (let i = 0; i < 12; i += 1) {
      const idx = hash[i] % dims;
      vec[idx] += 1 + (hash[i + 12] % 3);
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

function extractConflictKey(text: string): {
  key?: string;
  polarity: 'positive' | 'negative' | 'neutral';
} {
  const negative = text.match(
    /(?:不喜欢|讨厌|不想|不要|避免)\s*([^，。!！?？]+)/,
  );
  if (negative?.[1])
    return { key: normalizeText(negative[1]), polarity: 'negative' };
  const positive = text.match(/(?:喜欢|爱|偏好|想要|优先)\s*([^，。!！?？]+)/);
  if (positive?.[1])
    return { key: normalizeText(positive[1]), polarity: 'positive' };
  return { polarity: 'neutral' };
}

function parseTriplet(text: string): {
  subject: string;
  predicate: string;
  object: string;
} {
  const parts = normalizeText(text).split(/\s+/).filter(Boolean);
  if (parts.length >= 3) {
    return {
      subject: parts[0] ?? 'User',
      predicate: parts[1] ?? 'fact',
      object: parts.slice(2).join(' '),
    };
  }
  return {
    subject: 'User',
    predicate: 'stated',
    object: normalizeText(text),
  };
}

function asPending(status: CompanionMemoryVector['status']): boolean {
  return status === 'pending' || status === 'candidate';
}

function lexicalScore(query: string, text: string): number {
  const q = normalizeText(query).toLowerCase();
  const t = normalizeText(text).toLowerCase();
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;
  const qTokens = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (qTokens.length === 0) return 0;
  let hit = 0;
  for (const token of qTokens) if (t.includes(token)) hit += 1;
  return hit / qTokens.length;
}

function graphRelationScore(
  query: string,
  item: CompanionMemoryVector,
): number {
  const triplet = parseTriplet(query);
  const subjectHit = lexicalScore(triplet.subject, item.subject ?? '');
  const predicateHit = lexicalScore(triplet.predicate, item.predicate ?? '');
  const objectHit = lexicalScore(triplet.object, item.object ?? item.text);
  const directTripletHit = lexicalScore(
    query,
    `${item.subject ?? ''} ${item.predicate ?? ''} ${item.object ?? ''}`,
  );
  return Math.max(
    directTripletHit,
    subjectHit * 0.2 + predicateHit * 0.4 + objectHit * 0.4,
  );
}

function rrfScore(rank: number, k = 60): number {
  return 1 / (k + rank + 1);
}

function qualityScore(item: CompanionMemoryVector): number {
  const tierWeight =
    item.tier === 'L0'
      ? 1
      : item.tier === 'L1'
        ? 0.8
        : item.tier === 'L2'
          ? 0.55
          : 0.35;
  const evidenceBoost = item.evidenceRef?.auditID ? 0.08 : 0;
  const archivedPenalty =
    item.isArchived || item.status === 'archived' ? 0.5 : 1;
  const statusPenalty =
    item.status === 'active' ? 1 : asPending(item.status) ? 0.75 : 0.4;
  return Math.max(
    0,
    Math.min(
      1.5,
      (item.confidence * 0.45 +
        item.score * 0.35 +
        tierWeight * 0.2 +
        evidenceBoost) *
        archivedPenalty *
        statusPenalty,
    ),
  );
}

function appendMutationEvent(
  projectDir: string,
  eventType: string,
  memoryID: string,
  payload: Record<string, unknown>,
): void {
  appendMemoryEvent(projectDir, {
    eventID: `evt_${randomUUID()}`,
    eventType,
    entityType: 'mem_cell',
    entityID: memoryID,
    payload,
  });
}

export function decayCompanionMemoryVectors(
  projectDir: string,
  halfLifeDays = 30,
): { updated: number; items: CompanionMemoryVector[] } {
  const items = listMemoryCells(projectDir);
  const safeHalfLife = Math.max(1, halfLifeDays);
  const lambda = Math.log(2) / safeHalfLife;
  const nowMs = Date.now();
  let updated = 0;

  const touched: CompanionMemoryVector[] = [];
  for (const item of items) {
    if (item.status !== 'active') continue;
    const ageDays = Math.max(
      0,
      (nowMs - Date.parse(item.updatedAt)) / (24 * 3600 * 1000),
    );
    const nextScore = Math.max(0.05, item.score * Math.exp(-lambda * ageDays));
    if (Math.abs(nextScore - item.score) <= 0.0001) continue;
    item.score = Number(nextScore.toFixed(4));
    if (item.score < 0.08) item.isArchived = true;
    item.updatedAt = nowIso();
    touched.push(item);
    updated += 1;
  }

  if (touched.length > 0) {
    upsertMemoryCells(projectDir, touched);
  }

  autoCleanupCompanionMemoryVectors(projectDir);
  return { updated, items: listMemoryCells(projectDir) };
}

export function autoCleanupCompanionMemoryVectors(
  projectDir: string,
  input?: {
    maxActive?: number;
    maxPendingAgeDays?: number;
    minQualityToKeep?: number;
  },
): { archived: number; superseded: number; retained: number } {
  const maxActive = Math.max(100, Math.floor(input?.maxActive ?? 600));
  const maxPendingAgeDays = Math.max(
    1,
    Math.floor(input?.maxPendingAgeDays ?? 45),
  );
  const minQualityToKeep = Math.max(
    0.05,
    Math.min(1.5, Number(input?.minQualityToKeep ?? 0.18)),
  );
  const nowMs = Date.now();
  const cells = listMemoryCells(projectDir);
  const touched: CompanionMemoryVector[] = [];
  let archived = 0;
  let superseded = 0;

  for (const cell of cells) {
    const ageDays = Math.max(
      0,
      (nowMs - Date.parse(cell.updatedAt)) / (24 * 3600 * 1000),
    );
    if (asPending(cell.status) && ageDays > maxPendingAgeDays) {
      cell.status = 'superseded';
      cell.updatedAt = nowIso();
      touched.push(cell);
      superseded += 1;
      appendMutationEvent(
        projectDir,
        'memory_auto_cleanup_pending_expired',
        cell.id,
        {
          ageDays: Number(ageDays.toFixed(2)),
        },
      );
      continue;
    }
    if (
      cell.status === 'active' &&
      qualityScore(cell) < minQualityToKeep &&
      ageDays > 14
    ) {
      cell.isArchived = true;
      cell.status = 'archived';
      cell.updatedAt = nowIso();
      touched.push(cell);
      archived += 1;
      appendMutationEvent(
        projectDir,
        'memory_auto_cleanup_low_quality',
        cell.id,
        {
          quality: Number(qualityScore(cell).toFixed(4)),
          ageDays: Number(ageDays.toFixed(2)),
        },
      );
    }
  }

  const active = cells.filter(
    (item) => item.status === 'active' && !item.isArchived,
  );
  if (active.length > maxActive) {
    const overflow = active
      .map((item) => ({
        item,
        q: qualityScore(item),
        age: Date.parse(item.updatedAt),
      }))
      .sort((a, b) => a.q - b.q || a.age - b.age)
      .slice(0, active.length - maxActive);
    for (const row of overflow) {
      row.item.isArchived = true;
      row.item.status = 'archived';
      row.item.updatedAt = nowIso();
      touched.push(row.item);
      archived += 1;
      appendMutationEvent(
        projectDir,
        'memory_auto_cleanup_capacity',
        row.item.id,
        {
          quality: Number(row.q.toFixed(4)),
        },
      );
    }
  }

  if (touched.length > 0) {
    upsertMemoryCells(projectDir, touched);
  }
  const retained = listMemoryCells(projectDir).filter(
    (item) => item.status === 'active' && !item.isArchived,
  ).length;
  return { archived, superseded, retained };
}

export function upsertCompanionMemoryVector(
  projectDir: string,
  input: {
    text: string;
    source?: string;
    activate?: boolean;
    confidence?: number;
    tier?: 'L0' | 'L1' | 'L2' | 'L3';
    sourceMessageID?: string;
    sourceType?: 'manual' | 'conversation' | 'reflect' | 'direct_correction';
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    domain?: 'work' | 'relationship' | 'personal' | 'system';
    evidenceRef?: CompanionMemoryVector['evidenceRef'];
  },
): CompanionMemoryVector {
  const text = normalizeText(input.text);
  if (!text) throw new Error('invalid_memory_text');

  decayCompanionMemoryVectors(projectDir);
  const items = listMemoryCells(projectDir);
  const embedding = textToEmbedding(text);
  const now = nowIso();

  const near = items
    .filter((item) => item.status === 'active')
    .map((item) => ({ item, sim: cosine(item.embedding, embedding) }))
    .sort((a, b) => b.sim - a.sim)[0];

  if (near && near.sim >= 0.95) {
    near.item.score = Math.min(1.5, near.item.score + 0.15);
    near.item.accessCount += 1;
    near.item.isArchived = false;
    near.item.lastAccessedAt = now;
    near.item.updatedAt = now;
    upsertMemoryCell(projectDir, near.item);
    appendMutationEvent(projectDir, 'memory_reinforced', near.item.id, {
      similarity: near.sim,
      sourceType: input.sourceType ?? 'manual',
    });
    return near.item;
  }

  const preference = extractConflictKey(text);
  const confidenceInput =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? input.confidence
      : input.tier === 'L0'
        ? 1
        : input.tier === 'L3'
          ? 0.4
          : 0.7;
  const confidence = Math.max(0, Math.min(1, confidenceInput));
  const tier =
    input.tier ?? (confidence >= 0.95 ? 'L0' : confidence >= 0.6 ? 'L1' : 'L2');
  const triplet = parseTriplet(text);

  const created: CompanionMemoryVector = {
    id: `mem_${randomUUID()}`,
    text,
    source: input.source?.trim() || 'manual',
    embedding,
    score: 1,
    confidence,
    tier,
    domain: input.domain ?? 'work',
    subject: triplet.subject,
    predicate: triplet.predicate,
    object: triplet.object,
    polarity: preference.polarity,
    sourceMessageID: input.sourceMessageID,
    sourceType: input.sourceType ?? 'manual',
    memoryKind: input.memoryKind,
    status: input.activate ? 'active' : 'pending',
    conflictKey: preference.key,
    evidenceRef: input.evidenceRef,
    accessCount: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  };

  if (preference.key && preference.polarity !== 'neutral') {
    const conflicting: CompanionMemoryVector[] = [];
    for (const item of items) {
      if (item.status === 'superseded' || item.status === 'archived') continue;
      const other = extractConflictKey(item.text);
      if (
        !other.key ||
        other.key !== preference.key ||
        other.polarity === 'neutral'
      )
        continue;
      if (other.polarity !== preference.polarity) conflicting.push(item);
    }

    if (conflicting.length > 0) {
      const lambda = Math.log(2) / 30;
      const newScore = created.confidence;
      const scored = conflicting.map((item) => {
        const ageDays = Math.max(
          0,
          (Date.now() - Date.parse(item.lastAccessedAt)) / (24 * 3600 * 1000),
        );
        const score = item.confidence * Math.exp(-lambda * ageDays);
        return { item, score };
      });
      const strongestOld = scored.sort((a, b) => b.score - a.score)[0];
      const threshold = 0.1;
      const forceOverride = created.sourceType === 'direct_correction';
      const shouldOverwrite =
        forceOverride ||
        (strongestOld ? newScore > strongestOld.score + threshold : false);

      if (shouldOverwrite) {
        created.status = 'active';
        for (const other of conflicting) {
          other.status = 'superseded';
          other.supersededBy = created.id;
          other.updatedAt = now;
        }
        upsertMemoryCells(projectDir, conflicting);
      } else {
        const wizard: CompanionMemoryCorrection = {
          id: `mcw_${randomUUID()}`,
          conflictKey: preference.key,
          candidateMemoryID: created.id,
          existingMemoryIDs: conflicting.map((item) => item.id),
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        upsertMemoryCorrection(projectDir, wizard);
        created.conflictWizardID = wizard.id;
        created.status = 'pending';
      }
    }
  }

  const saved = upsertMemoryCell(projectDir, created);
  appendMutationEvent(projectDir, 'memory_candidate_created', saved.id, {
    status: saved.status,
    sourceType: saved.sourceType,
    conflictKey: saved.conflictKey ?? null,
    hasEvidence: Boolean(saved.evidenceRef?.auditID),
  });
  return saved;
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
    domain?: 'work' | 'relationship' | 'personal' | 'system';
    mode?: 'hybrid' | 'vector' | 'keyword';
  },
): Array<
  CompanionMemoryVector & {
    similarity: number;
    rankScore: number;
    quality: number;
    vectorScore: number;
    lexicalScore: number;
    relationScore: number;
  }
> {
  const q = normalizeText(query);
  if (!q) return [];

  const qEmb = textToEmbedding(q);
  const items = listMemoryCells(projectDir).filter(
    (item) =>
      item.status === 'active' &&
      !item.isArchived &&
      (!options?.domain || (item.domain ?? 'work') === options.domain),
  );
  if (items.length === 0) return [];

  const nowMs = Date.now();
  const recencyHalfLifeDays = Math.max(1, options?.recencyHalfLifeDays ?? 30);
  const alpha = options?.alpha ?? 0.6;
  const beta = options?.beta ?? 0.2;
  const gamma = options?.gamma ?? 0.2;
  const threshold = Math.max(0, options?.threshold ?? 0.15);

  const importanceFromTier = (tier: CompanionMemoryVector['tier']): number =>
    tier === 'L0' ? 1 : tier === 'L1' ? 0.7 : 0.4;

  const recency = (at: string): number => {
    const deltaDays = Math.max(
      0,
      (nowMs - Date.parse(at)) / (24 * 3600 * 1000),
    );
    const lambda = Math.log(2) / recencyHalfLifeDays;
    return Math.exp(-lambda * deltaDays);
  };

  const vectorRanked = items
    .map((item) => ({ item, score: cosine(item.embedding, qEmb) }))
    .sort((a, b) => b.score - a.score);
  const lexicalRanked = items
    .map((item) => ({ item, score: lexicalScore(q, item.text) }))
    .sort((a, b) => b.score - a.score);
  const relationRanked = items
    .map((item) => ({ item, score: graphRelationScore(q, item) }))
    .sort((a, b) => b.score - a.score);

  const vectorIndex = new Map<string, number>();
  const lexicalIndex = new Map<string, number>();
  const relationIndex = new Map<string, number>();
  vectorRanked.forEach((entry, index) => vectorIndex.set(entry.item.id, index));
  lexicalRanked.forEach((entry, index) =>
    lexicalIndex.set(entry.item.id, index),
  );
  relationRanked.forEach((entry, index) =>
    relationIndex.set(entry.item.id, index),
  );

  const ranked = items
    .map((item) => {
      const similarity = cosine(item.embedding, qEmb);
      const lexical = lexicalScore(q, item.text);
      const relation = graphRelationScore(q, item);
      const quality = qualityScore(item);
      const importance = importanceFromTier(item.tier) * quality;
      const vectorRrf = rrfScore(vectorIndex.get(item.id) ?? 999);
      const lexicalRrf = rrfScore(lexicalIndex.get(item.id) ?? 999);
      const relationRrf = rrfScore(relationIndex.get(item.id) ?? 999);
      const mode = options?.mode ?? 'hybrid';
      const fusedRecall =
        mode === 'vector'
          ? vectorRrf
          : mode === 'keyword'
            ? lexicalRrf + relationRrf * 0.5
            : vectorRrf + lexicalRrf + relationRrf;
      const rankScore =
        alpha * fusedRecall +
        beta * recency(item.lastAccessedAt) +
        gamma * importance;
      return {
        ...item,
        similarity,
        rankScore,
        quality,
        vectorScore: similarity,
        lexicalScore: lexical,
        relationScore: relation,
      };
    })
    .filter((item) => item.rankScore >= threshold)
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, Math.max(1, limit));

  if (ranked.length > 0) {
    const touched = new Map<string, CompanionMemoryVector>();
    for (const item of ranked) {
      item.accessCount += 1;
      item.lastAccessedAt = nowIso();
      touched.set(item.id, item);
    }
    upsertMemoryCells(projectDir, Array.from(touched.values()));
  }

  autoCleanupCompanionMemoryVectors(projectDir);
  return ranked;
}

export function listCompanionMemoryVectors(
  projectDir: string,
): CompanionMemoryVector[] {
  return listMemoryCells(projectDir);
}

export function listPendingCompanionMemoryVectors(
  projectDir: string,
): CompanionMemoryVector[] {
  return listMemoryCells(projectDir).filter((item) => asPending(item.status));
}

export function listCompanionMemoryCorrections(
  projectDir: string,
): CompanionMemoryCorrection[] {
  return listMemoryCorrections(projectDir);
}

export function updateCompanionMemoryVector(
  projectDir: string,
  input: {
    memoryID: string;
    text?: string;
    memoryKind?: 'Fact' | 'Insight' | 'UserPreference';
    confidence?: number;
    tier?: 'L0' | 'L1' | 'L2' | 'L3';
    status?: 'pending' | 'candidate' | 'active' | 'superseded' | 'archived';
  },
): CompanionMemoryVector | null {
  const target = listMemoryCells(projectDir).find(
    (item) => item.id === input.memoryID,
  );
  if (!target) return null;

  const nextText =
    typeof input.text === 'string' && input.text.trim()
      ? normalizeText(input.text)
      : target.text;
  const confidenceInput =
    typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, Number(input.confidence)))
      : target.confidence;

  target.text = nextText;
  target.embedding = textToEmbedding(nextText);
  const conflict = extractConflictKey(nextText);
  target.conflictKey = conflict.key;
  target.polarity = conflict.polarity;
  target.confidence = confidenceInput;
  target.tier =
    input.tier ??
    (confidenceInput >= 0.95 ? 'L0' : confidenceInput >= 0.6 ? 'L1' : 'L2');
  target.memoryKind =
    input.memoryKind === 'Fact' ||
    input.memoryKind === 'Insight' ||
    input.memoryKind === 'UserPreference'
      ? input.memoryKind
      : target.memoryKind;
  if (input.status) target.status = input.status;
  target.updatedAt = nowIso();
  if (target.status === 'active') target.lastAccessedAt = target.updatedAt;

  const saved = upsertMemoryCell(projectDir, target);
  appendMutationEvent(projectDir, 'memory_updated', saved.id, {
    status: saved.status,
    tier: saved.tier,
  });
  return saved;
}

export function archiveCompanionMemoryVector(
  projectDir: string,
  input: {
    memoryID: string;
    archived: boolean;
  },
): CompanionMemoryVector | null {
  const target = listMemoryCells(projectDir).find(
    (item) => item.id === input.memoryID,
  );
  if (!target) return null;

  target.isArchived = Boolean(input.archived);
  target.status = target.isArchived
    ? 'archived'
    : target.status === 'archived'
      ? 'active'
      : target.status;
  target.updatedAt = nowIso();
  const saved = upsertMemoryCell(projectDir, target);
  appendMutationEvent(projectDir, 'memory_archive_toggled', saved.id, {
    archived: saved.isArchived,
  });
  return saved;
}

export function confirmCompanionMemoryVector(
  projectDir: string,
  input: {
    memoryID: string;
    confirm: boolean;
    supersedeConflicts?: boolean;
  },
): CompanionMemoryVector | null {
  const all = listMemoryCells(projectDir);
  const target = all.find((item) => item.id === input.memoryID);
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
      const sourcePolarity = extractConflictKey(target.text).polarity;
      const touched: CompanionMemoryVector[] = [];
      for (const item of all) {
        if (item.id === target.id || item.status === 'superseded') continue;
        if (item.conflictKey !== target.conflictKey) continue;
        const itemPolarity = extractConflictKey(item.text).polarity;
        if (
          sourcePolarity !== 'neutral' &&
          itemPolarity !== 'neutral' &&
          sourcePolarity !== itemPolarity
        ) {
          item.status = 'superseded';
          item.supersededBy = target.id;
          item.updatedAt = now;
          touched.push(item);
        }
      }
      if (touched.length > 0) upsertMemoryCells(projectDir, touched);
    }
  }

  const saved = upsertMemoryCell(projectDir, target);

  if (target.conflictWizardID) {
    const correction = listMemoryCorrections(projectDir).find(
      (item) => item.id === target.conflictWizardID,
    );
    if (correction) {
      correction.status = input.confirm ? 'resolved' : 'rejected';
      correction.updatedAt = now;
      upsertMemoryCorrection(projectDir, correction);
    }
  }

  appendMutationEvent(projectDir, 'memory_confirmed', saved.id, {
    confirm: input.confirm,
    supersedeConflicts: Boolean(input.supersedeConflicts),
  });
  return saved;
}
