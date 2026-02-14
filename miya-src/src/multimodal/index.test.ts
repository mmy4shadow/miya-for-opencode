import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMediaItem, ingestMedia } from '../media/store';
import { analyzeVision, parseDesktopOcrSignals } from './vision';
import { generateImage } from './image';
import { ingestVoiceInput, synthesizeVoiceOutput } from './voice';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-multimodal-test-'));
}

describe('multimodal', () => {
  test('generates image metadata asset', async () => {
    const prev = process.env.MIYA_MULTIMODAL_TEST_MODE;
    process.env.MIYA_MULTIMODAL_TEST_MODE = '1';
    const projectDir = tempProjectDir();
    try {
      const result = await generateImage(projectDir, {
        prompt: 'a portrait photo',
        model: 'local:test-model',
      });
      expect(result.media.kind).toBe('image');
      expect(result.model).toBe('local:test-model');
      expect(result.media.localPath).toBeDefined();
      expect(fs.existsSync(result.media.localPath as string)).toBe(true);
      expect(result.media.metadata?.status).toBe('degraded_runtime_not_ready');
      expect(String(result.media.metadata?.runtimeError ?? '')).toContain(
        'python_runtime_not_ready:',
      );
      expect(result.media.metadata?.tier).toBe('reference');
      expect(result.media.metadata?.degraded).toBe(true);
      expect(String(result.media.metadata?.engineMessage ?? '')).toContain('test_mode');
    } finally {
      if (prev === undefined) delete process.env.MIYA_MULTIMODAL_TEST_MODE;
      else process.env.MIYA_MULTIMODAL_TEST_MODE = prev;
    }
  });

  test('ingests voice input and generates voice output asset', async () => {
    const prev = process.env.MIYA_MULTIMODAL_TEST_MODE;
    process.env.MIYA_MULTIMODAL_TEST_MODE = '1';
    const projectDir = tempProjectDir();
    const input = ingestVoiceInput(projectDir, {
      text: '你好',
      source: 'manual',
    });
    expect(input.text).toBe('你好');

    try {
      const output = await synthesizeVoiceOutput(projectDir, {
        text: '测试语音输出',
        format: 'mp3',
      });
      expect(output.media.kind).toBe('audio');
      expect(output.format).toBe('mp3');
      expect(output.media.localPath).toBeDefined();
      expect(fs.existsSync(output.media.localPath as string)).toBe(true);
      expect(output.media.metadata?.status).toBe('degraded_runtime_not_ready');
      expect(String(output.media.metadata?.runtimeError ?? '')).toContain(
        'python_runtime_not_ready:',
      );
      expect(output.media.metadata?.tier).toBe('reference');
      expect(output.media.metadata?.degraded).toBe(true);
      expect(String(output.media.metadata?.engineMessage ?? '')).toContain('test_mode');
    } finally {
      if (prev === undefined) delete process.env.MIYA_MULTIMODAL_TEST_MODE;
      else process.env.MIYA_MULTIMODAL_TEST_MODE = prev;
    }
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

  test('detects recipient and sent status from OCR text', () => {
    const signals = parseDesktopOcrSignals('聊天对象: 小明\\n消息已发送', '小明');
    expect(signals.recipientMatch).toBe('matched');
    expect(signals.sendStatusDetected).toBe('sent');
  });

  test('detects recipient mismatch from OCR text', () => {
    const signals = parseDesktopOcrSignals('聊天对象: 李雷\\n消息已发送', '小明');
    expect(signals.recipientMatch).toBe('mismatch');
  });

  test('detects uncertain send status when no signal exists', () => {
    const signals = parseDesktopOcrSignals('聊天对象: 小明\\n输入中', '小明');
    expect(signals.recipientMatch).toBe('matched');
    expect(signals.sendStatusDetected).toBe('uncertain');
  });
});
