import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateImage } from '../multimodal/image';
import { synthesizeVoiceOutput } from '../multimodal/voice';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-multimodal-integration-'));
}

const integration = process.env.MIYA_RUN_INTEGRATION === '1' ? test : test.skip;

describe('multimodal integration (real runtime)', () => {
  integration('generates image through daemon runtime', async () => {
    const prev = process.env.MIYA_MULTIMODAL_TEST_MODE;
    process.env.MIYA_MULTIMODAL_TEST_MODE = '0';
    try {
      const result = await generateImage(tempProjectDir(), {
        prompt: 'studio portrait',
      });
      expect(result.media.kind).toBe('image');
      const status = result.media.metadata?.status;
      if (process.env.MIYA_REQUIRE_LOCAL_RUNTIME === '1') {
        expect(status).toBe('generated_local');
      } else {
        expect(['generated_local', 'degraded_runtime_not_ready']).toContain(status);
      }
    } finally {
      if (prev === undefined) delete process.env.MIYA_MULTIMODAL_TEST_MODE;
      else process.env.MIYA_MULTIMODAL_TEST_MODE = prev;
    }
  });

  integration('synthesizes voice through daemon runtime', async () => {
    const prev = process.env.MIYA_MULTIMODAL_TEST_MODE;
    process.env.MIYA_MULTIMODAL_TEST_MODE = '0';
    try {
      const result = await synthesizeVoiceOutput(tempProjectDir(), {
        text: 'integration tts check',
      });
      expect(result.media.kind).toBe('audio');
      const status = result.media.metadata?.status;
      if (process.env.MIYA_REQUIRE_LOCAL_RUNTIME === '1') {
        expect(status).toBe('generated_local');
      } else {
        expect(['generated_local', 'degraded_runtime_not_ready']).toContain(status);
      }
    } finally {
      if (prev === undefined) delete process.env.MIYA_MULTIMODAL_TEST_MODE;
      else process.env.MIYA_MULTIMODAL_TEST_MODE = prev;
    }
  });
});
