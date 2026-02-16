import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  confirmCompanionMemoryVector,
  decayCompanionMemoryVectors,
  listCompanionMemoryCorrections,
  listCompanionMemoryVectors,
  listPendingCompanionMemoryVectors,
  mergePendingMemoryConflicts,
  searchCompanionMemoryVectors,
  upsertCompanionMemoryVector,
} from './memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-vector-test-'));
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
    expect(searchCompanionMemoryVectors(projectDir, '抹茶', 3).length).toBeGreaterThan(0);
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
    const weak = searchCompanionMemoryVectors(projectDir, 'unrelated-query', 5, {
      threshold: 0.95,
    });
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
    const all = searchCompanionMemoryVectors(projectDir, '抹茶拿铁', 10, { threshold: 0 });
    expect(all.some((item) => item.id === corrected.id)).toBe(true);
    const vectors = listPendingCompanionMemoryVectors(projectDir);
    expect(vectors.some((item) => item.id === corrected.id)).toBe(false);
    const pendingCorrections = listCompanionMemoryCorrections(projectDir);
    expect(pendingCorrections.length).toBe(0);
    const storeHit = searchCompanionMemoryVectors(projectDir, '不喜欢 抹茶拿铁', 5, { threshold: 0 });
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
    const relationship = searchCompanionMemoryVectors(projectDir, '抹茶拿铁', 5, {
      threshold: 0,
      domain: 'relationship',
    });
    expect(work.every((item) => item.domain === 'work')).toBe(true);
    expect(relationship.every((item) => item.domain === 'relationship')).toBe(true);
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
    expect(listPendingCompanionMemoryVectors(projectDir, 'work').length).toBe(1);
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
    expect(pending.filter((item) => item.text.includes('不喜欢抹茶拿铁')).length).toBe(1);
  });
});
