import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  listCompanionMemoryVectors,
  searchCompanionMemoryVectors,
} from '../../src/companion/memory-vector';
import { getMiyaRuntimeDir } from '../../src/workflow';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-arch-test-'));
}

describe('memory system architecture integrity', () => {
  test('sanitizes malformed persisted memory records instead of crashing', () => {
    const projectDir = tempProjectDir();
    const runtimeDir = getMiyaRuntimeDir(projectDir);
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'companion-memory-vectors.json'),
      JSON.stringify(
        {
          version: 2,
          items: [
            {
              id: 123,
              text: { bad: true },
              domain: 'work',
              status: 'active',
              embedding: [1, '2', null, 'NaN'],
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );

    const items = listCompanionMemoryVectors(projectDir);
    expect(items.length).toBe(1);
    expect(items[0]?.id.startsWith('mem_')).toBe(true);
    expect(items[0]?.text).toBe('');
    expect(items[0]?.embedding).toEqual([1, 2]);

    expect(() =>
      searchCompanionMemoryVectors(projectDir, 'user preference', 3),
    ).not.toThrow();
  });
});

