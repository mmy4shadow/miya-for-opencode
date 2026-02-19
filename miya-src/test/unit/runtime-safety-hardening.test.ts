import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseIncomingFrame } from '../../src/gateway/protocol';
import { ingestMedia, runMediaGc } from '../../src/media/store';
import { safeInterval } from '../../src/utils/safe-interval';
import { getMiyaRuntimeDir } from '../../src/workflow';

function tempProjectDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('wait_timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('runtime safety hardening', () => {
  test('parses websocket binary payloads for API contract compatibility', () => {
    const raw = JSON.stringify({
      type: 'request',
      id: 'bin-1',
      method: 'gateway.status.get',
      params: {},
    });
    const uint8Parsed = parseIncomingFrame(new TextEncoder().encode(raw));
    expect(uint8Parsed.error).toBeUndefined();
    expect(uint8Parsed.frame?.type).toBe('request');

    const arrayBuffer = new TextEncoder().encode(raw).buffer;
    const bufferParsed = parseIncomingFrame(arrayBuffer);
    expect(bufferParsed.error).toBeUndefined();
    expect(bufferParsed.frame?.type).toBe('request');
  });

  test('reports accurate consecutive error count in safeInterval observability', async () => {
    const errors: Array<{
      consecutiveErrors: number;
      cooldownUntilMs?: number;
    }> = [];

    const timer = safeInterval(
      'probe',
      10,
      () => {
        throw new Error('boom');
      },
      {
        maxConsecutiveErrors: 3,
        cooldownMs: 1000,
        onError: (input) => {
          errors.push({
            consecutiveErrors: input.consecutiveErrors,
            cooldownUntilMs: input.cooldownUntilMs,
          });
        },
      },
    );

    try {
      await waitFor(() => errors.length >= 3);
      expect(errors[0]?.consecutiveErrors).toBe(1);
      expect(errors[1]?.consecutiveErrors).toBe(2);
      expect(errors[2]?.consecutiveErrors).toBe(3);
      expect(typeof errors[2]?.cooldownUntilMs).toBe('number');
    } finally {
      clearInterval(timer);
    }
  });

  test('does not delete files outside managed media directory during gc', () => {
    const projectDir = tempProjectDir('miya-media-gc-');
    const outsideFile = path.join(projectDir, 'outside.txt');
    fs.writeFileSync(outsideFile, 'keep-me', 'utf-8');

    const media = ingestMedia(projectDir, {
      source: 'manual',
      kind: 'file',
      mimeType: 'text/plain',
      fileName: 'note.txt',
      contentBase64: Buffer.from('payload').toString('base64'),
      ttlHours: 1,
    });

    const indexFile = path.join(
      getMiyaRuntimeDir(projectDir),
      'media',
      'index.json',
    );
    const parsed = JSON.parse(fs.readFileSync(indexFile, 'utf-8')) as {
      items: Record<string, { expiresAt: string; localPath?: string }>;
    };
    parsed.items[media.id] = {
      ...parsed.items[media.id],
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      localPath: outsideFile,
    };
    fs.writeFileSync(indexFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');

    const result = runMediaGc(projectDir);
    expect(result.removed).toBe(1);
    expect(fs.existsSync(outsideFile)).toBe(true);
  });
});
