import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildTranscribeDoneEvent,
  buildTranscribeRequestedEvent,
} from '../../src/media/transcribe';
import { generateImage } from '../../src/multimodal/image';
import { ingestVoiceInput, synthesizeVoiceOutput } from '../../src/multimodal/voice';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-multimodal-quality-'));
}

describe('multimodal error quality and asr processing', () => {
  test('returns actionable image generation validation message', async () => {
    const projectDir = tempProjectDir();
    await expect(
      generateImage(projectDir, {
        prompt: '   ',
      }),
    ).rejects.toThrow('invalid_prompt:prompt must not be empty');
  });

  test('returns actionable voice synthesis validation message', async () => {
    const projectDir = tempProjectDir();
    await expect(
      synthesizeVoiceOutput(projectDir, {
        text: '  ',
      }),
    ).rejects.toThrow('invalid_tts_text:text must not be empty');
  });

  test('returns actionable voice ingest validation message', () => {
    const projectDir = tempProjectDir();
    expect(() =>
      ingestVoiceInput(projectDir, {
        source: 'manual',
      }),
    ).toThrow('invalid_voice_input:text empty and media transcript unavailable');
  });

  test('normalizes ASR request payload and rejects empty media id', () => {
    const event = buildTranscribeRequestedEvent({
      mediaID: '  media-001  ',
      language: '  zh-CN ',
    });
    expect(event.event).toBe('media.transcribe.request');
    expect(event.payload).toEqual({
      mediaID: 'media-001',
      language: 'zh-CN',
    });

    expect(() =>
      buildTranscribeRequestedEvent({
        mediaID: '   ',
      }),
    ).toThrow('invalid_media_transcribe_request:mediaID is required');
  });

  test('normalizes ASR done payload and clamps confidence', () => {
    const event = buildTranscribeDoneEvent({
      mediaID: ' media-002 ',
      transcript: '  测试文本  ',
      confidence: 9,
    });
    expect(event.event).toBe('media.transcribe.done');
    expect(event.payload).toEqual({
      mediaID: 'media-002',
      transcript: '测试文本',
      confidence: 1,
    });

    expect(() =>
      buildTranscribeDoneEvent({
        mediaID: 'media-003',
        transcript: '   ',
      }),
    ).toThrow('invalid_media_transcribe_result:transcript must not be empty');
  });
});
