import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('e2e smoke: core entrypoints are present', () => {
  const root = path.resolve(import.meta.dir, '..', '..');
  expect(fs.existsSync(path.join(root, 'src', 'index.ts'))).toBeTrue();
  expect(fs.existsSync(path.join(root, 'src', 'gateway', 'index.ts'))).toBeTrue();
});
