import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import {
  readEmbeddingProviderConfig,
  writeEmbeddingProviderConfig,
} from './memory-embedding';
import { runMemoryRecallBenchmark } from './memory-recall-benchmark';
import {
  auditCompanionMemoryDrift,
  confirmCompanionMemoryVector,
  decayCompanionMemoryVectors,
  listCompanionMemoryCorrections,
  listCompanionMemoryVectors,
  listPendingCompanionMemoryVectors,
  mergePendingMemoryConflicts,
  recycleCompanionMemoryDrift,
  searchCompanionMemoryVectors,
  upsertCompanionMemoryVector,
} from './memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-vector-test-'));
}

function patchMemoryStore(
  projectDir: string,
  patcher: (items: Array<Record<string, unknown>>) => void,
): void {
  const file = path.join(
    getMiyaRuntimeDir(projectDir),
    'companion-memory-vectors.json',
  );
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    version: number;
    items: Array<Record<string, unknown>>;
  };
  patcher(raw.items);
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');
}

describe('companion memory vectors', () => {
  test('supports pending -> active two-stage memory activation', () => {
    const projectDir = tempProjectDir();
    const created = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
      activate: false,
    });
    expect(created.status).toBe('pending');
    expect(listPendingCompanionMemoryVectors(projectDir).length).toBe(1);
    expect(searchCompanionMemoryVectors(projectDir, '抹茶', 3).length).toBe(0);

    const confirmed = confirmCompanionMemoryVector(projectDir, {
      memoryID: created.id,
      confirm: true,
      supersedeConflicts: true,
    });
    expect(confirmed?.status).toBe('active');
    expect(
      searchCompanionMemoryVectors(projectDir, '抹茶', 3).length,
    ).toBeGreaterThan(0);
  });

  test('creates correction wizard entry for conflicting memories', () => {
    const projectDir = tempProjectDir();
    const first = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
      activate: true,
    });
    const conflict = upsertCompanionMemoryVector(projectDir, {
      text: '我不喜欢抹茶拿铁',
      source: 'test',
    });
    expect(first.status).toBe('active');
    expect(conflict.status).toBe('pending');
    expect(conflict.conflictWizardID).toBeDefined();
    expect(listCompanionMemoryCorrections(projectDir).length).toBe(1);
  });

  test('supports insert + search + decay', () => {
    const projectDir = tempProjectDir();
    const mem = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
      activate: true,
    });
    expect(mem.status).toBe('active');
    const hit = searchCompanionMemoryVectors(projectDir, '抹茶', 3);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]?.text.includes('抹茶')).toBe(true);

    const decay = decayCompanionMemoryVectors(projectDir, 7);
    expect(decay.items.length).toBeGreaterThan(0);
  });

  test('search supports dynamic pruning threshold', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'User likes TypeScript',
      source: 'test',
      activate: true,
    });
    const weak = searchCompanionMemoryVectors(
      projectDir,
      'unrelated-query',
      5,
      {
        threshold: 0.95,
      },
    );
    expect(weak.length).toBe(0);
    const normal = searchCompanionMemoryVectors(projectDir, 'TypeScript', 5, {
      threshold: 0.1,
    });
    expect(normal.length).toBeGreaterThan(0);
  });

  test('direct correction force-overwrites conflicting memory', () => {
    const projectDir = tempProjectDir();
    const oldMem = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
      activate: true,
      sourceType: 'conversation',
      confidence: 0.9,
    });
    const corrected = upsertCompanionMemoryVector(projectDir, {
      text: '我不喜欢抹茶拿铁',
      source: 'test',
      activate: false,
      sourceType: 'direct_correction',
      confidence: 0.7,
    });
    expect(corrected.status).toBe('active');
    const all = searchCompanionMemoryVectors(projectDir, '抹茶拿铁', 10, {
      threshold: 0,
    });
    expect(all.some((item) => item.id === corrected.id)).toBe(true);
    const vectors = listPendingCompanionMemoryVectors(projectDir);
    expect(vectors.some((item) => item.id === corrected.id)).toBe(false);
    const pendingCorrections = listCompanionMemoryCorrections(projectDir);
    expect(pendingCorrections.length).toBe(0);
    const storeHit = searchCompanionMemoryVectors(
      projectDir,
      '不喜欢 抹茶拿铁',
      5,
      { threshold: 0 },
    );
    expect(storeHit.some((item) => item.id === corrected.id)).toBe(true);
  });

  test('supports domain-separated retrieval', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'Fix TypeScript build pipeline',
      source: 'test',
      activate: true,
      domain: 'work',
    });
    upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
      activate: true,
      domain: 'relationship',
    });
    const work = searchCompanionMemoryVectors(projectDir, 'TypeScript', 5, {
      threshold: 0,
      domain: 'work',
    });
    const relationship = searchCompanionMemoryVectors(
      projectDir,
      '抹茶拿铁',
      5,
      {
        threshold: 0,
        domain: 'relationship',
      },
    );
    expect(work.every((item) => item.domain === 'work')).toBe(true);
    expect(relationship.every((item) => item.domain === 'relationship')).toBe(
      true,
    );
  });

  test('supports layered retrieval and dual-channel lexical recall', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'Tool trace: cargo test failed due to missing feature flag',
      source: 'test',
      activate: true,
      domain: 'work',
      semanticLayer: 'tool_trace',
    });
    upsertCompanionMemoryVector(projectDir, {
      text: 'User likes oat milk latte',
      source: 'test',
      activate: true,
      domain: 'relationship',
      semanticLayer: 'preference',
    });
    const traceHits = searchCompanionMemoryVectors(
      projectDir,
      'feature flag missing in test',
      5,
      {
        threshold: 0,
        domain: 'work',
        semanticLayers: ['tool_trace'],
        semanticWeight: 0.2,
        lexicalWeight: 0.8,
      },
    );
    expect(traceHits.length).toBeGreaterThan(0);
    expect(traceHits[0]?.semanticLayer).toBe('tool_trace');
    expect(traceHits[0]?.lexicalSimilarity).toBeGreaterThan(0);
    const prefHits = searchCompanionMemoryVectors(
      projectDir,
      'what latte does user like',
      5,
      {
        threshold: 0,
        semanticLayers: ['preference'],
      },
    );
    expect(prefHits.length).toBeGreaterThan(0);
    expect(prefHits[0]?.semanticLayer).toBe('preference');
  });

  test('supports pluggable embedding provider with fallback config', () => {
    const projectDir = tempProjectDir();
    const next = writeEmbeddingProviderConfig(projectDir, {
      kind: 'local-ngram',
      dims: 96,
    });
    expect(next.kind).toBe('local-ngram');
    const loaded = readEmbeddingProviderConfig(projectDir);
    expect(loaded.kind).toBe('local-ngram');
    upsertCompanionMemoryVector(projectDir, {
      text: '用户偏好热美式',
      source: 'test',
      activate: true,
      semanticLayer: 'preference',
    });
    const hits = searchCompanionMemoryVectors(projectDir, '热美式偏好', 3, {
      threshold: 0,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.embeddingProvider.includes('local-ngram')).toBe(true);
  });

  test('runs offline recall benchmark with recall@k output', () => {
    const report = runMemoryRecallBenchmark();
    expect(report.cases).toBeGreaterThan(0);
    expect(report.recallAtK['recall@3']).toBeGreaterThan(0.5);
    expect(report.caseResults.length).toBe(report.cases);
  });

  test('requires evidence to activate cross-domain memory writes', () => {
    const projectDir = tempProjectDir();
    const created = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢咖啡',
      source: 'test',
      domain: 'work',
      activate: true,
    });
    expect(created.status).toBe('pending');
    expect(created.crossDomainWrite?.requiresApproval).toBe(true);
    expect(listPendingCompanionMemoryVectors(projectDir, 'work').length).toBe(
      1,
    );
    expect(() =>
      confirmCompanionMemoryVector(projectDir, {
        memoryID: created.id,
        confirm: true,
      }),
    ).toThrow('cross_domain_evidence_required');
    const activated = confirmCompanionMemoryVector(projectDir, {
      memoryID: created.id,
      confirm: true,
      evidence: ['mode=mixed', 'user_explicit_memory_write=1'],
    });
    expect(activated?.status).toBe('active');
    expect(activated?.crossDomainWrite?.requiresApproval).toBe(false);
    const vectors = listCompanionMemoryVectors(projectDir, 'work');
    expect(vectors.some((item) => item.id === created.id)).toBe(true);
  });

  test('merges duplicate pending conflicts within budget', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
      activate: true,
      confidence: 0.9,
    });
    const a = upsertCompanionMemoryVector(projectDir, {
      text: '我不喜欢抹茶拿铁',
      source: 'test',
      activate: false,
      confidence: 0.7,
    });
    const b = upsertCompanionMemoryVector(projectDir, {
      text: '我不喜欢抹茶拿铁',
      source: 'test',
      activate: false,
      confidence: 0.6,
    });
    expect(a.status).toBe('pending');
    expect(b.status).toBe('pending');
    const merged = mergePendingMemoryConflicts(projectDir, { maxSupersede: 5 });
    expect(merged.merged).toBeGreaterThanOrEqual(1);
    const pending = listPendingCompanionMemoryVectors(projectDir);
    expect(
      pending.filter((item) => item.text.includes('不喜欢抹茶拿铁')).length,
    ).toBe(1);
  });

  test('audits and recycles stale low-signal active memories', () => {
    const projectDir = tempProjectDir();
    const created = upsertCompanionMemoryVector(projectDir, {
      text: '临时偏好：周末喝热可可',
      source: 'test',
      activate: true,
      confidence: 0.22,
    });
    const oldIso = new Date(Date.now() - 65 * 24 * 3600 * 1000).toISOString();
    patchMemoryStore(projectDir, (items) => {
      const target = items.find((item) => item.id === created.id);
      if (!target) return;
      target.updatedAt = oldIso;
      target.lastAccessedAt = oldIso;
      target.accessCount = 0;
      target.score = 0.06;
      target.confidence = 0.2;
    });

    const report = auditCompanionMemoryDrift(projectDir, {
      staleDays: 30,
      minScore: 0.1,
      minConfidence: 0.4,
      limit: 20,
    });
    const signal = report.items.find((item) => item.memoryID === created.id);
    expect(
      signal?.reason === 'stale_low_access' ||
        signal?.reason === 'confidence_collapse',
    ).toBe(true);

    const recycled = recycleCompanionMemoryDrift(projectDir, {
      staleDays: 30,
      minScore: 0.1,
      minConfidence: 0.4,
      maxActions: 10,
    });
    expect(recycled.applied).toBeGreaterThan(0);
    const target = listCompanionMemoryVectors(projectDir).find(
      (item) => item.id === created.id,
    );
    expect(target?.isArchived).toBe(true);
  });

  test('recycles conflicting parallel active memories by superseding weaker one', () => {
    const projectDir = tempProjectDir();
    const old = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
      activate: true,
      confidence: 0.9,
    });
    const pending = upsertCompanionMemoryVector(projectDir, {
      text: '我不喜欢抹茶拿铁',
      source: 'test',
      activate: false,
      confidence: 0.6,
    });
    const activated = confirmCompanionMemoryVector(projectDir, {
      memoryID: pending.id,
      confirm: true,
      supersedeConflicts: false,
    });
    expect(activated?.status).toBe('active');

    const report = auditCompanionMemoryDrift(projectDir, { limit: 20 });
    const conflictSignal = report.items.find(
      (item) =>
        item.reason === 'conflict_parallel_active' &&
        item.memoryID === (activated?.id ?? ''),
    );
    expect(conflictSignal).toBeDefined();

    const recycled = recycleCompanionMemoryDrift(projectDir, {
      maxActions: 10,
      limit: 20,
    });
    expect(recycled.superseded.length).toBeGreaterThan(0);
    const vectors = listCompanionMemoryVectors(projectDir);
    const oldState = vectors.find((item) => item.id === old.id);
    const newState = vectors.find((item) => item.id === activated?.id);
    expect(oldState?.status === 'active' || newState?.status === 'active').toBe(
      true,
    );
    expect(
      oldState?.status === 'superseded' || newState?.status === 'superseded',
    ).toBe(true);
  });

  test('recycles timed-out cross-domain pending memory', () => {
    const projectDir = tempProjectDir();
    const created = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢浓缩咖啡',
      source: 'test',
      domain: 'work',
      activate: true,
    });
    expect(created.status).toBe('pending');
    const oldIso = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
    patchMemoryStore(projectDir, (items) => {
      const target = items.find((item) => item.id === created.id);
      if (!target) return;
      target.updatedAt = oldIso;
      target.lastAccessedAt = oldIso;
    });

    const report = auditCompanionMemoryDrift(projectDir, {
      crossDomainPendingDays: 7,
      limit: 20,
    });
    const timeoutSignal = report.items.find(
      (item) => item.memoryID === created.id,
    );
    expect(timeoutSignal?.reason).toBe('cross_domain_pending_timeout');

    const recycled = recycleCompanionMemoryDrift(projectDir, {
      crossDomainPendingDays: 7,
      maxActions: 10,
    });
    expect(recycled.applied).toBeGreaterThan(0);
    const after = listCompanionMemoryVectors(projectDir).find(
      (item) => item.id === created.id,
    );
    expect(after?.status).toBe('superseded');
  });
});
