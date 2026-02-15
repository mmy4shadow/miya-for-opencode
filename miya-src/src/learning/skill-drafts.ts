import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RalphLoopResult } from '../ralph';
import type { CompanionMemoryVector } from '../companion/memory-vector';
import { getMiyaRuntimeDir } from '../workflow';

export type SkillDraftStatus = 'draft' | 'recommended' | 'accepted' | 'rejected';
export type SkillDraftSource = 'ralph' | 'reflect';

export interface SkillDraft {
  id: string;
  source: SkillDraftSource;
  status: SkillDraftStatus;
  title: string;
  problemPattern: string;
  solutionPattern: string;
  commands: string[];
  tags: string[];
  confidence: number;
  uses: number;
  hits: number;
  misses: number;
  createdAt: string;
  updatedAt: string;
}

interface SkillDraftStore {
  drafts: SkillDraft[];
}

interface SkillDraftMatch {
  draft: SkillDraft;
  score: number;
}

export interface LearningStats {
  total: number;
  byStatus: Record<SkillDraftStatus, number>;
  totalUses: number;
  hitRate: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'learning-skill-drafts.json');
}

function normalizeText(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      normalizeText(text)
        .toLowerCase()
        .split(/[^a-z0-9_\-\u4e00-\u9fff]+/i)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    ),
  );
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(getMiyaRuntimeDir(projectDir), { recursive: true });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDraft(raw: Partial<SkillDraft>): SkillDraft {
  const now = nowIso();
  return {
    id: String(raw.id ?? `draft_${randomUUID()}`),
    source: raw.source === 'reflect' ? 'reflect' : 'ralph',
    status:
      raw.status === 'accepted' ||
      raw.status === 'rejected' ||
      raw.status === 'recommended' ||
      raw.status === 'draft'
        ? raw.status
        : 'draft',
    title: normalizeText(String(raw.title ?? '')),
    problemPattern: normalizeText(String(raw.problemPattern ?? '')),
    solutionPattern: normalizeText(String(raw.solutionPattern ?? '')),
    commands: Array.isArray(raw.commands)
      ? raw.commands.map(String).map(normalizeText).filter(Boolean)
      : [],
    tags: Array.isArray(raw.tags)
      ? raw.tags.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean)
      : [],
    confidence: clamp(Number(raw.confidence ?? 0.5), 0.1, 0.99),
    uses: clamp(Number(raw.uses ?? 0), 0, 1_000_000),
    hits: clamp(Number(raw.hits ?? 0), 0, 1_000_000),
    misses: clamp(Number(raw.misses ?? 0), 0, 1_000_000),
    createdAt: raw.createdAt ? String(raw.createdAt) : now,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : now,
  };
}

function readStore(projectDir: string): SkillDraftStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return { drafts: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as SkillDraftStore;
    const drafts = Array.isArray(parsed?.drafts)
      ? parsed.drafts.map((item) => normalizeDraft(item))
      : [];
    return { drafts };
  } catch {
    return { drafts: [] };
  }
}

function writeStore(projectDir: string, store: SkillDraftStore): void {
  ensureDir(projectDir);
  fs.writeFileSync(filePath(projectDir), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function findSimilarDraftIndex(drafts: SkillDraft[], candidate: SkillDraft): number {
  const signature = hashText(
    `${candidate.source}|${candidate.problemPattern}|${candidate.solutionPattern}|${candidate.commands.join('|')}`,
  );
  return drafts.findIndex((item) => {
    const current = hashText(
      `${item.source}|${item.problemPattern}|${item.solutionPattern}|${item.commands.join('|')}`,
    );
    return current === signature;
  });
}

function upsertDraft(projectDir: string, draft: SkillDraft): SkillDraft {
  const store = readStore(projectDir);
  const index = findSimilarDraftIndex(store.drafts, draft);
  if (index >= 0) {
    const current = store.drafts[index];
    const merged: SkillDraft = normalizeDraft({
      ...current,
      ...draft,
      id: current.id,
      createdAt: current.createdAt,
      confidence: (current.confidence * 0.7 + draft.confidence * 0.3),
      status:
        current.status === 'accepted' || current.status === 'rejected'
          ? current.status
          : draft.status,
      tags: Array.from(new Set([...current.tags, ...draft.tags])).slice(0, 12),
      updatedAt: nowIso(),
    });
    store.drafts[index] = merged;
    writeStore(projectDir, store);
    return merged;
  }
  const next = normalizeDraft(draft);
  store.drafts = [next, ...store.drafts].slice(0, 500);
  writeStore(projectDir, store);
  return next;
}

function draftScoreForQuery(draft: SkillDraft, query: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const targetTokens = new Set(
    tokenize(`${draft.title} ${draft.problemPattern} ${draft.solutionPattern} ${draft.tags.join(' ')}`),
  );
  let overlap = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) overlap += 1;
  }
  const overlapScore = overlap / queryTokens.length;
  const quality = draft.confidence;
  const statusBoost =
    draft.status === 'accepted' ? 0.12 : draft.status === 'recommended' ? 0.06 : 0;
  return clamp(overlapScore * 0.75 + quality * 0.25 + statusBoost, 0, 1);
}

function matchDrafts(
  projectDir: string,
  query: string,
  threshold: number,
  limit: number,
): SkillDraftMatch[] {
  const store = readStore(projectDir);
  return store.drafts
    .filter((draft) => draft.status !== 'rejected')
    .map((draft) => ({ draft, score: draftScoreForQuery(draft, query) }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

export function listSkillDrafts(
  projectDir: string,
  input?: { limit?: number; status?: SkillDraftStatus },
): SkillDraft[] {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(input?.limit ?? 50))));
  const store = readStore(projectDir);
  return store.drafts
    .filter((draft) => (input?.status ? draft.status === input.status : true))
    .slice(0, limit);
}

export function setSkillDraftStatus(
  projectDir: string,
  draftID: string,
  status?: SkillDraftStatus,
  usage?: { hit: boolean },
): SkillDraft | null {
  const store = readStore(projectDir);
  const index = store.drafts.findIndex((item) => item.id === draftID);
  if (index < 0) return null;
  const current = store.drafts[index];
  const next: SkillDraft = normalizeDraft({
    ...current,
    status: status ?? current.status,
    uses: usage ? current.uses + 1 : current.uses,
    hits: usage ? current.hits + (usage.hit ? 1 : 0) : current.hits,
    misses: usage ? current.misses + (usage.hit ? 0 : 1) : current.misses,
    updatedAt: nowIso(),
  });
  store.drafts[index] = next;
  writeStore(projectDir, store);
  return next;
}

export function getLearningStats(projectDir: string): LearningStats {
  const drafts = readStore(projectDir).drafts;
  const byStatus: LearningStats['byStatus'] = {
    draft: 0,
    recommended: 0,
    accepted: 0,
    rejected: 0,
  };
  let totalUses = 0;
  let totalHits = 0;
  for (const draft of drafts) {
    byStatus[draft.status] += 1;
    totalUses += draft.uses;
    totalHits += draft.hits;
  }
  return {
    total: drafts.length,
    byStatus,
    totalUses,
    hitRate: totalUses > 0 ? Number((totalHits / totalUses).toFixed(4)) : 0,
  };
}

export function buildLearningInjection(
  projectDir: string,
  query: string,
  input?: { threshold?: number; limit?: number },
): { snippet?: string; matchedDraftIDs: string[] } {
  const threshold = clamp(Number(input?.threshold ?? 0.64), 0.3, 0.98);
  const limit = Math.max(1, Math.min(3, Math.floor(Number(input?.limit ?? 2))));
  const matches = matchDrafts(projectDir, query, threshold, limit);
  if (matches.length === 0) return { snippet: undefined, matchedDraftIDs: [] };
  const lines: string[] = [
    '[MIYA_LEARNING_DRAFT_REUSE]',
    'Matched historical patterns (use as guidance, then verify):',
  ];
  for (const item of matches) {
    lines.push(`- draft=${item.draft.id} score=${item.score.toFixed(2)} title=${item.draft.title}`);
    lines.push(`  pattern=${item.draft.problemPattern}`);
    lines.push(`  fix=${item.draft.solutionPattern}`);
    if (item.draft.commands.length > 0) {
      lines.push(`  commands=${item.draft.commands.join(' ; ')}`);
    }
  }
  return {
    snippet: lines.join('\n'),
    matchedDraftIDs: matches.map((item) => item.draft.id),
  };
}

export function createSkillDraftFromRalph(
  projectDir: string,
  input: {
    taskDescription: string;
    result: RalphLoopResult;
  },
): SkillDraft | null {
  const fixCommands = input.result.attempts
    .filter((item) => item.type === 'fix')
    .map((item) => normalizeText(item.result.command))
    .filter(Boolean);
  if (fixCommands.length === 0) return null;
  const latestVerify = [...input.result.attempts]
    .reverse()
    .find((item) => item.type === 'verify');
  const problemSummary = normalizeText(latestVerify?.failureSummary ?? input.result.summary);
  const confidence = input.result.success ? 0.82 : 0.58;

  return upsertDraft(projectDir, {
    id: `draft_${randomUUID()}`,
    source: 'ralph',
    status: input.result.success ? 'recommended' : 'draft',
    title: `Ralph 修复模式: ${normalizeText(input.taskDescription).slice(0, 48)}`,
    problemPattern: problemSummary || 'verification_failed_pattern',
    solutionPattern: input.result.summary,
    commands: fixCommands.slice(0, 4),
    tags: ['ralph', input.result.reason ?? 'unknown'],
    confidence,
    uses: 0,
    hits: 0,
    misses: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

export function createSkillDraftsFromReflect(
  projectDir: string,
  input: {
    createdMemories: CompanionMemoryVector[];
  },
): SkillDraft[] {
  const memories = Array.isArray(input.createdMemories) ? input.createdMemories : [];
  if (memories.length === 0) return [];
  const preferenceMemories = memories
    .filter((item) => item.memoryKind === 'UserPreference')
    .slice(0, 6);
  if (preferenceMemories.length === 0) return [];

  const pattern = preferenceMemories.map((item) => item.text).join(' | ');
  const draft = upsertDraft(projectDir, {
    id: `draft_${randomUUID()}`,
    source: 'reflect',
    status: 'draft',
    title: 'Reflect 偏好执行草案',
    problemPattern: '任务执行涉及用户习惯或偏好判断',
    solutionPattern: `优先遵循近期偏好记忆：${pattern}`,
    commands: [],
    tags: ['reflect', 'preference'],
    confidence: 0.62,
    uses: 0,
    hits: 0,
    misses: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  return [draft];
}

