import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleControlUiHttpRequest } from './control-ui';
import { normalizeControlUiBasePath } from './control-ui-shared';

describe('normalizeControlUiBasePath', () => {
  test('normalizes leading and trailing slashes', () => {
    expect(normalizeControlUiBasePath('ui/')).toBe('/ui');
    expect(normalizeControlUiBasePath('/')).toBe('');
    expect(normalizeControlUiBasePath('')).toBe('');
  });
});

describe('handleControlUiHttpRequest', () => {
  test('returns 503 when root is missing', async () => {
    const request = new Request('http://127.0.0.1/');
    const response = handleControlUiHttpRequest(request, {
      root: { kind: 'missing' },
    });
    expect(response?.status).toBe(503);
  });

  test('serves index.html from resolved root', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'miya-ui-'));
    writeFileSync(path.join(root, 'index.html'), '<html><body>ok</body></html>', 'utf-8');

    const request = new Request('http://127.0.0.1/');
    const response = handleControlUiHttpRequest(request, {
      root: { kind: 'resolved', path: root },
    });
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain('ok');
  });

  test('falls back to index for SPA route', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'miya-ui-'));
    mkdirSync(path.join(root, 'assets'), { recursive: true });
    writeFileSync(path.join(root, 'index.html'), '<html><body>spa</body></html>', 'utf-8');

    const request = new Request('http://127.0.0.1/app/settings');
    const response = handleControlUiHttpRequest(request, {
      root: { kind: 'resolved', path: root },
    });
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain('spa');
  });
});

