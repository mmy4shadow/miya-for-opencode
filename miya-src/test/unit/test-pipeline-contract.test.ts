import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(currentDir, '..', '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
  scripts?: Record<string, string>;
};

describe('test pipeline contract', () => {
  test('root test script separates core vitest tests and gateway-ui vitest run', () => {
    const testScript = packageJson.scripts?.test ?? '';

    expect(testScript.includes('npm run test:core')).toBe(true);
    expect(testScript.includes('npm run test:ui')).toBe(true);
    expect(testScript.includes('bun')).toBe(false);
  });

  test('dedicated test entry points are present for CI splitting', () => {
    const testCore = packageJson.scripts?.['test:core'] ?? '';
    expect(testCore.includes('npm run typecheck')).toBe(true);
    expect(testCore.includes('vitest run')).toBe(true);
    expect(packageJson.scripts?.['test:ui']).toBe('npm --prefix gateway-ui run test:run');
    expect(packageJson.scripts?.['test:integration']).toBe(
      'tsx tools/run-integration-suite.ts',
    );
  });
});
