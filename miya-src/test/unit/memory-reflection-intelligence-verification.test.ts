import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendShortTermMemoryLog,
  reflectCompanionMemory,
} from '../../src/companion/memory-reflect';
import { listPendingCompanionMemoryVectors } from '../../src/companion/memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-reflect-intel-'));
}

describe('memory reflection intelligence verification', () => {
  test('supports verification-only reflect with maxWrites=0', () => {
    const projectDir = tempProjectDir();
    appendShortTermMemoryLog(projectDir, {
      sessionID: 's-memory',
      sender: 'user',
      text: '我喜欢无糖饮料',
    });

    const result = reflectCompanionMemory(projectDir, {
      force: true,
      maxWrites: 0,
    });

    expect(result.processedLogs).toBe(1);
    expect(result.generatedTriplets).toBeGreaterThan(0);
    expect(result.createdMemories.length).toBe(0);
    expect(listPendingCompanionMemoryVectors(projectDir).length).toBe(0);
  });
});
