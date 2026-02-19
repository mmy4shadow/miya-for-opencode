import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { testCategories } from '../config/test.config';

const testRoot = path.resolve(import.meta.dir, '..');

function listTestsRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestsRecursively(absolute));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

describe('test organization and structure', () => {
  test('each configured category has at least one test file', () => {
    for (const [category, definition] of Object.entries(testCategories)) {
      const directory = definition.pattern.replace('/**/*.test.ts', '');
      const absolute = path.join(process.cwd(), directory);
      expect(fs.existsSync(absolute)).toBe(true);
      const tests = listTestsRecursively(absolute);
      expect(tests.length).toBeGreaterThan(0);
      expect(
        tests.every((file) => file.includes(`${path.sep}${category}${path.sep}`)),
      ).toBe(true);
    }
  });

  test('test root docs and baseline folders are present', () => {
    expect(fs.existsSync(path.join(testRoot, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(testRoot, 'AUDIT_EXECUTION_REPORT.md'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(testRoot, 'baselines', 'benchmarks.json')),
    ).toBe(true);
    expect(fs.existsSync(path.join(testRoot, 'reports'))).toBe(true);
  });
});
