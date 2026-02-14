import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ingestMedia } from '../media/store';
import {
  markTrainingJobFinished,
  markTrainingJobRunning,
  readCompanionWizardState,
  startCompanionWizard,
  submitWizardPersonality,
  submitWizardPhotos,
  submitWizardVoice,
} from './wizard';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-companion-wizard-test-'));
}

const ONE_PIXEL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6sYz0AAAAASUVORK5CYII=';

describe('companion wizard', () => {
  test('follows photo -> image training -> voice -> personality state machine', () => {
    const projectDir = tempProjectDir();
    const start = startCompanionWizard(projectDir, { sessionId: 's1', forceReset: true });
    expect(start.state).toBe('awaiting_photos');

    const imageMedia = ingestMedia(projectDir, {
      source: 'test',
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'p.png',
      contentBase64: ONE_PIXEL_BASE64,
    });
    const photos = submitWizardPhotos(projectDir, { mediaIDs: [imageMedia.id] });
    expect(photos.state.state).toBe('training_image');
    expect(photos.job.type).toBe('training.image');

    markTrainingJobRunning(projectDir, photos.job.id);
    const afterImage = markTrainingJobFinished(projectDir, {
      jobID: photos.job.id,
      status: 'degraded',
      message: 'ok',
      tier: 'embedding',
    });
    expect(afterImage.state).toBe('awaiting_voice');

    const audioMedia = ingestMedia(projectDir, {
      source: 'test',
      kind: 'audio',
      mimeType: 'audio/wav',
      fileName: 'v.wav',
      contentBase64: ONE_PIXEL_BASE64,
    });
    const voice = submitWizardVoice(projectDir, { mediaID: audioMedia.id });
    expect(voice.state.state).toBe('training_voice');

    markTrainingJobRunning(projectDir, voice.job.id);
    const afterVoice = markTrainingJobFinished(projectDir, {
      jobID: voice.job.id,
      status: 'completed',
      message: 'ok',
      tier: 'lora',
    });
    expect(afterVoice.state).toBe('awaiting_personality');

    const done = submitWizardPersonality(projectDir, { personalityText: '你是个讽刺的艺术学生' });
    expect(done.state).toBe('completed');
    expect(readCompanionWizardState(projectDir).assets.personalityText.length).toBeGreaterThan(0);
  });
});
