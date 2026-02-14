import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ingestMedia } from '../media/store';
import { detectMultimodalIntent } from '../multimodal/intent';
import {
  cancelCompanionWizardTraining,
  isCompanionWizardEmpty,
  markTrainingJobFinished,
  markTrainingJobRunning,
  requeueTrainingJob,
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
    expect(readCompanionWizardState(projectDir, 's1').assets.personalityText.length).toBeGreaterThan(
      0,
    );

    const selfie = detectMultimodalIntent('给我发张自拍');
    const voiceIntent = detectMultimodalIntent('用你的声音发一条语音给[小明]');
    expect(selfie.type).toBe('selfie');
    expect(voiceIntent.type).toBe('voice_to_friend');
  });

  test('enforces photo count 1-5 and session-isolated wizard file path', () => {
    const projectDir = tempProjectDir();
    startCompanionWizard(projectDir, { sessionId: 'room_a', forceReset: true });
    const imageMedia = ingestMedia(projectDir, {
      source: 'test',
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'p.png',
      contentBase64: ONE_PIXEL_BASE64,
    });
    expect(() =>
      submitWizardPhotos(projectDir, {
        sessionId: 'room_a',
        mediaIDs: Array.from({ length: 6 }, () => imageMedia.id),
      }),
    ).toThrow(/must_be_1_to_5/);

    const legacyFile = path.join(
      projectDir,
      '.opencode',
      'miya',
      'profiles',
      'companion',
      'current',
      'wizard-session.json',
    );
    expect(fs.existsSync(legacyFile)).toBe(false);
  });

  test('cancel marks queued/running jobs canceled and keeps wizard retryable', () => {
    const projectDir = tempProjectDir();
    startCompanionWizard(projectDir, { sessionId: 'cancel_case', forceReset: true });
    const imageMedia = ingestMedia(projectDir, {
      source: 'test',
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'p.png',
      contentBase64: ONE_PIXEL_BASE64,
    });
    const photos = submitWizardPhotos(projectDir, {
      sessionId: 'cancel_case',
      mediaIDs: [imageMedia.id],
    });
    markTrainingJobRunning(projectDir, photos.job.id, 'cancel_case');
    const canceled = cancelCompanionWizardTraining(projectDir, 'cancel_case');
    expect(canceled.jobs.some((job) => job.status === 'canceled')).toBe(true);
    expect(isCompanionWizardEmpty(projectDir, 'cancel_case')).toBe(false);
  });

  test('covers failed/degraded/retry paths for training jobs', () => {
    const projectDir = tempProjectDir();
    startCompanionWizard(projectDir, { sessionId: 'retry_case', forceReset: true });
    const imageMedia = ingestMedia(projectDir, {
      source: 'test',
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'p.png',
      contentBase64: ONE_PIXEL_BASE64,
    });

    const photos = submitWizardPhotos(projectDir, {
      sessionId: 'retry_case',
      mediaIDs: [imageMedia.id],
    });
    markTrainingJobRunning(projectDir, photos.job.id, 'retry_case');
    const failedImage = markTrainingJobFinished(projectDir, {
      sessionId: 'retry_case',
      jobID: photos.job.id,
      status: 'failed',
      message: 'oom',
      tier: 'reference',
    });
    expect(failedImage.state).toBe('training_image');

    const requeued = requeueTrainingJob(projectDir, {
      sessionId: 'retry_case',
      jobID: photos.job.id,
      message: 'retry_from_checkpoint',
      checkpointPath: 'checkpoint/image-ref.safetensors',
    });
    expect(requeued.jobs.find((job) => job.id === photos.job.id)?.status).toBe('queued');

    markTrainingJobRunning(projectDir, photos.job.id, 'retry_case');
    const degradedImage = markTrainingJobFinished(projectDir, {
      sessionId: 'retry_case',
      jobID: photos.job.id,
      status: 'degraded',
      message: 'fallback_embedding',
      tier: 'embedding',
    });
    expect(degradedImage.state).toBe('awaiting_voice');

    const audioMedia = ingestMedia(projectDir, {
      source: 'test',
      kind: 'audio',
      mimeType: 'audio/wav',
      fileName: 'v.wav',
      contentBase64: ONE_PIXEL_BASE64,
    });
    const voice = submitWizardVoice(projectDir, {
      sessionId: 'retry_case',
      mediaID: audioMedia.id,
    });
    markTrainingJobRunning(projectDir, voice.job.id, 'retry_case');
    const failedVoice = markTrainingJobFinished(projectDir, {
      sessionId: 'retry_case',
      jobID: voice.job.id,
      status: 'failed',
      message: 'voice_train_failed',
      tier: 'reference',
    });
    expect(failedVoice.state).toBe('training_voice');
  });
});
