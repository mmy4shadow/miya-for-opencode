import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('performance smoke: benchmark script exists', () => {
  const root = path.resolve(import.meta.dir, '..', '..');
  const script = path.join(root, 'tools', 'memory-recall-benchmark.ts');
  expect(fs.existsSync(script)).toBeTrue();
});
