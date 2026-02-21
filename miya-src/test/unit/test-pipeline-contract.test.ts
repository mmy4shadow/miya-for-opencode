import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const packageJsonPath = path.join(import.meta.dir, '..', '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
  scripts?: Record<string, string>;
};

describe('test pipeline contract', () => {
  test('root test script separates core bun tests and gateway-ui vitest run', () => {
    const testScript = packageJson.scripts?.test ?? '';

    expect(testScript.includes('bun test --cwd src --max-concurrency=1')).toBe(true);
    expect(testScript.includes('bun test --cwd test --max-concurrency=1')).toBe(true);
    expect(testScript.includes('bun run --cwd gateway-ui test:run')).toBe(true);
  });

  test('dedicated test entry points are present for CI splitting', () => {
    expect(packageJson.scripts?.['test:core']).toBe(
      'bun test --cwd src --max-concurrency=1 && bun test --cwd test --max-concurrency=1',
    );
    expect(packageJson.scripts?.['test:ui']).toBe('bun run --cwd gateway-ui test:run');
  });
});
