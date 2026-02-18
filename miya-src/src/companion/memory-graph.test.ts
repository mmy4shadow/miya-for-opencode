import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getCompanionMemoryGraphStats,
  listCompanionMemoryGraphNeighbors,
  searchCompanionMemoryGraph,
} from './memory-graph';
import { upsertCompanionMemoryVector } from './memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-graph-test-'));
}

describe('companion memory graph', () => {
  test('searches graph edges and reports stats', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: 'User likes matcha latte',
      source: 'test',
      activate: true,
      memoryKind: 'UserPreference',
      confidence: 0.9,
    });
    upsertCompanionMemoryVector(projectDir, {
      text: 'User requires TypeScript lint pass',
      source: 'test',
      activate: true,
      memoryKind: 'Fact',
      confidence: 0.8,
    });
    const hits = searchCompanionMemoryGraph(projectDir, 'matcha', 5);
    expect(hits.length).toBeGreaterThan(0);
    const neighbors = listCompanionMemoryGraphNeighbors(projectDir, 'User', 10);
    expect(neighbors.length).toBeGreaterThan(0);
    const stats = getCompanionMemoryGraphStats(projectDir);
    expect(stats.edgeCount).toBeGreaterThanOrEqual(2);
    expect(Object.keys(stats.byLayer).length).toBeGreaterThan(0);
  });
});
