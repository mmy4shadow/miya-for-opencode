import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('integration smoke: required integration assets are present', () => {
  const root = path.resolve(import.meta.dir, '..', '..');
  const runtimeTest = path.join(root, 'src', 'integration', 'multimodal.runtime.integration.test.ts');
  expect(fs.existsSync(runtimeTest)).toBeTrue();
});
