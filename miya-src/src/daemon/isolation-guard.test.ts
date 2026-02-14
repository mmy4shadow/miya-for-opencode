import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

function listTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('daemon isolation guard', () => {
  test('non-daemon modules must not import daemon service directly', () => {
    const srcRoot = path.join(import.meta.dir, '..');
    const files = listTsFiles(srcRoot);
    const violations: string[] = [];

    for (const file of files) {
      const rel = path.relative(srcRoot, file).replaceAll('\\', '/');
      if (rel.startsWith('daemon/')) continue;
      const content = fs.readFileSync(file, 'utf-8');
      if (/from\s+['"][^'"]*daemon\/service(?:\.ts)?['"]/.test(content)) {
        violations.push(`${rel}:forbidden_import_daemon_service`);
      }
      if (/\bMiyaDaemonService\b/.test(content)) {
        violations.push(`${rel}:forbidden_symbol_MiyaDaemonService`);
      }
    }

    expect(violations).toEqual([]);
  });
});
