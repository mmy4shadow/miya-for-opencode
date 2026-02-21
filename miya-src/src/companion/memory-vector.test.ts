import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  archiveCompanionMemoryVector,
  confirmCompanionMemoryVector,
  decayCompanionMemoryVectors,
  listCompanionMemoryCorrections,
  listPendingCompanionMemoryVectors,
  searchCompanionMemoryVectors,
  updateCompanionMemoryVector,
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
    const _oldMem = upsertCompanionMemoryVector(projectDir, {
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

  test('supports memory update and archive toggling', () => {
    const projectDir = tempProjectDir();
    const created = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢拿铁',
      source: 'test',
      activate: true,
      memoryKind: 'Fact',
    });
    const updated = updateCompanionMemoryVector(projectDir, {
      memoryID: created.id,
      text: '我更喜欢燕麦拿铁',
      memoryKind: 'UserPreference',
      confidence: 0.92,
      status: 'active',
    });
    expect(updated?.text).toContain('燕麦拿铁');
    expect(updated?.memoryKind).toBe('UserPreference');
    expect(updated?.confidence).toBe(0.92);

    const archived = archiveCompanionMemoryVector(projectDir, {
      memoryID: created.id,
      archived: true,
    });
    expect(archived?.isArchived).toBe(true);

    const restored = archiveCompanionMemoryVector(projectDir, {
      memoryID: created.id,
      archived: false,
    });
    expect(restored?.isArchived).toBe(false);
  });
});
