import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  searchCompanionMemoryVectors,
  upsertCompanionMemoryVector,
  type MemoryDomain,
  type MemorySemanticLayer,
} from './memory-vector';

export interface MemoryRecallFixture {
  id?: string;
  text: string;
  domain?: MemoryDomain;
  semanticLayer?: MemorySemanticLayer;
}

export interface MemoryRecallCase {
  id?: string;
  query: string;
  expected: string[];
  domain?: MemoryDomain;
  semanticLayers?: MemorySemanticLayer[];
  k?: number;
}

export interface MemoryRecallDataset {
  name: string;
  fixtures: MemoryRecallFixture[];
  cases: MemoryRecallCase[];
}

export interface MemoryRecallCaseResult {
  id: string;
  query: string;
  k: number;
  expected: string[];
  retrieved: string[];
  hit: boolean;
}

export interface MemoryRecallBenchmarkResult {
  dataset: string;
  cases: number;
  recallAtK: Record<string, number>;
  caseResults: MemoryRecallCaseResult[];
}

const DEFAULT_DATASET_PATH = path.join(
  __dirname,
  'benchmarks',
  'recall-default.json',
);

function normalizeDataset(raw: Partial<MemoryRecallDataset>): MemoryRecallDataset {
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'memory-recall-default',
    fixtures: Array.isArray(raw.fixtures)
      ? raw.fixtures
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id.trim() || undefined : undefined,
            text: String(item.text ?? '').trim(),
            domain:
              item.domain === 'work' || item.domain === 'relationship'
                ? item.domain
                : undefined,
            semanticLayer:
              item.semanticLayer === 'episodic' ||
              item.semanticLayer === 'semantic' ||
              item.semanticLayer === 'preference' ||
              item.semanticLayer === 'tool_trace'
                ? item.semanticLayer
                : undefined,
          }))
          .filter((item) => item.text.length > 0)
      : [],
    cases: Array.isArray(raw.cases)
      ? raw.cases
          .map((item, index) => ({
            id:
              typeof item.id === 'string' && item.id.trim()
                ? item.id.trim()
                : `case_${index + 1}`,
            query: String(item.query ?? '').trim(),
            expected: Array.isArray(item.expected)
              ? item.expected.map((entry) => String(entry).trim()).filter(Boolean)
              : [],
            domain:
              item.domain === 'work' || item.domain === 'relationship'
                ? item.domain
                : undefined,
            semanticLayers: Array.isArray(item.semanticLayers)
              ? item.semanticLayers.filter(
                  (entry): entry is MemorySemanticLayer =>
                    entry === 'episodic' ||
                    entry === 'semantic' ||
                    entry === 'preference' ||
                    entry === 'tool_trace',
                )
              : undefined,
            k:
              typeof item.k === 'number' && Number.isFinite(item.k)
                ? Math.max(1, Math.min(20, Math.floor(item.k)))
                : undefined,
          }))
          .filter((item) => item.query.length > 0 && item.expected.length > 0)
      : [],
  };
}

export function loadMemoryRecallDataset(datasetPath?: string): MemoryRecallDataset {
  const file = datasetPath && datasetPath.trim() ? datasetPath : DEFAULT_DATASET_PATH;
  if (!fs.existsSync(file)) {
    throw new Error(`dataset_not_found:${file}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MemoryRecallDataset>;
  return normalizeDataset(raw);
}

function isCaseHit(expected: string[], retrieved: string[]): boolean {
  const expectedLower = expected.map((item) => item.toLowerCase());
  for (const row of retrieved) {
    const lower = row.toLowerCase();
    if (expectedLower.some((item) => lower.includes(item))) return true;
  }
  return false;
}

export function runMemoryRecallBenchmark(input?: {
  datasetPath?: string;
  dataset?: MemoryRecallDataset;
  kValues?: number[];
}): MemoryRecallBenchmarkResult {
  const dataset = input?.dataset ?? loadMemoryRecallDataset(input?.datasetPath);
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-benchmark-'));
  const fixtureIDMap = new Map<string, string>();
  for (const fixture of dataset.fixtures) {
    const created = upsertCompanionMemoryVector(workdir, {
      text: fixture.text,
      source: 'benchmark',
      activate: true,
      domain: fixture.domain,
      semanticLayer: fixture.semanticLayer,
      learningStage: 'persistent',
    });
    if (fixture.id) fixtureIDMap.set(fixture.id, created.id);
  }

  const ks =
    Array.isArray(input?.kValues) && input.kValues.length > 0
      ? input.kValues.map((value) => Math.max(1, Math.min(20, Math.floor(value))))
      : [1, 3, 5, 8];

  const perK: Record<number, { hit: number; total: number }> = {};
  for (const k of ks) perK[k] = { hit: 0, total: 0 };

  const caseResults: MemoryRecallCaseResult[] = [];
  for (const item of dataset.cases) {
    const expected = item.expected.map((entry) => fixtureIDMap.get(entry) ?? entry);
    const maxK = Math.max(item.k ?? 0, ...ks);
    const hits = searchCompanionMemoryVectors(workdir, item.query, maxK, {
      threshold: 0,
      domain: item.domain,
      semanticLayers: item.semanticLayers,
    });
    const retrievedRows = hits.map((row) => `${row.id} ${row.text}`);
    for (const k of ks) {
      const topk = retrievedRows.slice(0, k);
      perK[k].total += 1;
      if (isCaseHit(expected, topk)) perK[k].hit += 1;
    }
    const caseK = item.k ?? 5;
    const retrievedCase = retrievedRows.slice(0, caseK);
    caseResults.push({
      id: item.id ?? `case_${caseResults.length + 1}`,
      query: item.query,
      k: caseK,
      expected,
      retrieved: retrievedCase,
      hit: isCaseHit(expected, retrievedCase),
    });
  }

  const recallAtK: Record<string, number> = {};
  for (const [k, score] of Object.entries(perK)) {
    recallAtK[`recall@${k}`] =
      score.total > 0 ? Number((score.hit / score.total).toFixed(4)) : 0;
  }

  return {
    dataset: dataset.name,
    cases: dataset.cases.length,
    recallAtK,
    caseResults,
  };
}
