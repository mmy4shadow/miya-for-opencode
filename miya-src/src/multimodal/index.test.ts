import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMediaItem, ingestMedia } from '../media/store';
import { analyzeVision } from './vision';
import { generateImage } from './image';
import { ingestVoiceInput, synthesizeVoiceOutput } from './voice';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-multimodal-test-'));
}

describe('multimodal', () => {
  test('generates image metadata asset', async () => {
    const projectDir = tempProjectDir();
    const result = await generateImage(projectDir, {
      prompt: 'a portrait photo',
      model: 'local:test-model',
    });
    expect(result.media.kind).toBe('image');
    expect(result.model).toBe('local:test-model');
    expect(result.media.localPath).toBeDefined();
    expect(fs.existsSync(result.media.localPath as string)).toBe(true);
  });

  test('ingests voice input and generates voice output asset', async () => {
    const projectDir = tempProjectDir();
    const input = ingestVoiceInput(projectDir, {
      text: '你好',
      source: 'manual',
    });
    expect(input.text).toBe('你好');

    const output = await synthesizeVoiceOutput(projectDir, {
      text: '测试语音输出',
      format: 'mp3',
    });
    expect(output.media.kind).toBe('audio');
    expect(output.format).toBe('mp3');
    expect(output.media.localPath).toBeDefined();
    expect(fs.existsSync(output.media.localPath as string)).toBe(true);
  });

  test('analyzes vision from image metadata', async () => {
    const projectDir = tempProjectDir();
    const media = ingestMedia(projectDir, {
      source: 'test',
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'img.png',
      metadata: {
        caption: 'a desk with laptop',
        tags: ['workspace', 'coding'],
      },
    });
    const result = await analyzeVision(projectDir, { mediaID: media.id });
    expect(result.mediaID).toBe(media.id);
    expect(result.summary.includes('desk')).toBe(true);
    expect(getMediaItem(projectDir, media.id)?.kind).toBe('image');
  });
});
