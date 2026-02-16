import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCompanionMemorySqliteStats } from './memory-sqlite';
import { upsertCompanionMemoryVector } from './memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-sqlite-test-'));
}

describe('companion memory sqlite sync', () => {
  test('syncs memory vectors into sqlite hot layer', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'User likes TypeScript',
      source: 'test',
      activate: true,
      confidence: 0.9,
      tier: 'L2',
      sourceMessageID: 'msg-1',
    });
    upsertCompanionMemoryVector(projectDir, {
      text: 'User dislikes noisy logs',
      source: 'test',
      activate: false,
      confidence: 0.7,
      tier: 'L2',
      sourceMessageID: 'msg-2',
    });
    const stats = getCompanionMemorySqliteStats(projectDir);
    expect(stats.memoryCount).toBeGreaterThanOrEqual(2);
    expect(stats.vectorCount).toBeGreaterThanOrEqual(2);
    expect(stats.byLearningStage.persistent).toBeGreaterThanOrEqual(1);
    expect(stats.sqlitePath.endsWith('memories.sqlite')).toBe(true);
    expect(fs.existsSync(stats.sqlitePath)).toBe(true);
  });
});
