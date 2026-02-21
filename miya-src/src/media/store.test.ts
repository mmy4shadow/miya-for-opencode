import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { ingestMedia, listMediaItems, runMediaGc } from './store';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-media-test-'));
}

describe('media store gc', () => {
  test('ingests media and prunes expired files', () => {
    const projectDir = tempProjectDir();

    const media = ingestMedia(projectDir, {
      source: 'telegram',
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'test.png',
      contentBase64: Buffer.from('abc').toString('base64'),
      ttlHours: 1,
    });

    expect(media.id.startsWith('media_')).toBe(true);
    expect(listMediaItems(projectDir).length).toBe(1);

    const runtimeMediaDir = path.join(projectDir, '.opencode', 'miya', 'media');
    const indexFile = path.join(runtimeMediaDir, 'index.json');
    const parsed = JSON.parse(fs.readFileSync(indexFile, 'utf-8')) as {
      items: Record<string, { expiresAt: string }>;
    };
    const raw = fs.readFileSync(indexFile, 'utf-8');
    expect(raw.includes('telegram')).toBe(false);
    expect(raw.includes('miya-sec:')).toBe(true);
    parsed.items[media.id].expiresAt = new Date(
      Date.now() - 1000,
    ).toISOString();
    fs.writeFileSync(
      indexFile,
      `${JSON.stringify(parsed, null, 2)}\n`,
      'utf-8',
    );

    const gc = runMediaGc(projectDir);
    expect(gc.removed).toBe(1);
    expect(gc.kept).toBe(0);
  });
});
