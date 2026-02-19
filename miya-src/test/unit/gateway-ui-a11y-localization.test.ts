import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const appFile = path.join(import.meta.dir, '..', '..', 'gateway-ui', 'src', 'App.tsx');
const appSource = fs.readFileSync(appFile, 'utf-8');

describe('gateway ui localization and accessibility', () => {
  test('uses runtime locale instead of hard-coded locale-only formatting', () => {
    expect(appSource.includes('function resolveUiLocale()')).toBe(true);
    expect(appSource.includes('new Intl.DateTimeFormat(locale')).toBe(true);
  });

  test('announces critical ui feedback via aria-live regions', () => {
    expect(appSource.includes('role="alert"')).toBe(true);
    expect(appSource.includes('aria-live="assertive"')).toBe(true);
    expect(appSource.includes('aria-live="polite"')).toBe(true);
  });
});
