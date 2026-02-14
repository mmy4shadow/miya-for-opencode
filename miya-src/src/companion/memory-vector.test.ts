import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  decayCompanionMemoryVectors,
  searchCompanionMemoryVectors,
  upsertCompanionMemoryVector,
} from './memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-vector-test-'));
}

describe('companion memory vectors', () => {
  test('supports insert + search + conflict supersede', () => {
    const projectDir = tempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢抹茶拿铁',
      source: 'test',
    });
    upsertCompanionMemoryVector(projectDir, {
      text: '我不喜欢抹茶拿铁',
      source: 'test',
    });

    const hit = searchCompanionMemoryVectors(projectDir, '抹茶', 3);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]?.text.includes('抹茶')).toBe(true);

    const decay = decayCompanionMemoryVectors(projectDir, 7);
    expect(decay.items.length).toBeGreaterThan(0);
  });
});
