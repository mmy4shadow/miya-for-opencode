import { addCompanionAsset } from '../companion/store';
import { getMiyaClient } from '../daemon';
import { getMediaItem, ingestMedia } from '../media/store';
import { getMiyaModelPath } from '../model/paths';
import { readConfig } from '../settings';
import { appendVoiceHistory } from '../voice/state';
import { getMiyaRuntimeDir } from '../workflow';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  VoiceInputIngest,
  VoiceInputResult,
  VoiceOutputInput,
  VoiceOutputResult,
} from './types';

const DEFAULT_VOICE = 'default';
const DEFAULT_TTS_MODEL = 'local:gpt-sovits-v2pro';

function resolveVoiceInputText(projectDir: string, input: VoiceInputIngest): string {
  const explicit = input.text?.trim();
  if (explicit) return explicit;
  if (!input.mediaID) return '';
  const media = getMediaItem(projectDir, input.mediaID);
  if (!media) return '';
  const transcript =
    typeof media.metadata?.transcript === 'string'
      ? String(media.metadata.transcript)
      : '';
  if (transcript.trim()) return transcript.trim();
  return `[media:${media.id}]`;
}

export function ingestVoiceInput(
  projectDir: string,
  input: VoiceInputIngest,
): VoiceInputResult {
  const source = input.source ?? (input.mediaID ? 'media' : 'manual');
  const text = resolveVoiceInputText(projectDir, input);
  if (!text) throw new Error('invalid_voice_input');

  appendVoiceHistory(projectDir, {
    text,
    source,
    language: input.language,
    mediaID: input.mediaID,
  });
  return {
    text,
    source,
    mediaID: input.mediaID,
  };
}

function normalizeFormat(format?: string): 'wav' | 'mp3' | 'ogg' {
  if (format === 'mp3' || format === 'ogg') return format;
  return 'wav';
}

function buildSilentWavBase64(durationMs: number): string {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer.toString('base64');
}

function toBase64FromFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath).toString('base64');
  } catch {
    return null;
  }
}

function isRuntimeNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.startsWith('python_runtime_not_ready:');
}

function parseModelUpdateTarget(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message.startsWith('model_update_required:')) return null;
  const [, target] = message.split(':');
  const normalized = String(target ?? '').trim();
  return normalized || null;
}

function useMultimodalTestMode(projectDir: string): boolean {
  if (process.env.MIYA_MULTIMODAL_TEST_MODE === '1') return true;
  const config = readConfig(projectDir);
  const runtime = config.runtime as Record<string, unknown> | undefined;
  const multimodal = runtime?.multimodal as Record<string, unknown> | undefined;
  return multimodal?.test_mode === true;
}

export async function synthesizeVoiceOutput(
  projectDir: string,
  input: VoiceOutputInput,
): Promise<VoiceOutputResult> {
  const daemon = getMiyaClient(projectDir);
  const text = input.text.trim();
  if (!text) throw new Error('invalid_tts_text');

  const voice = input.voice?.trim() || DEFAULT_VOICE;
  const model = input.model?.trim() || DEFAULT_TTS_MODEL;
  const format = normalizeFormat(input.format);
  const mimeType =
    format === 'mp3' ? 'audio/mpeg' : format === 'ogg' ? 'audio/ogg' : 'audio/wav';
  const estDurationMs = Math.max(600, Math.min(7000, text.length * 55));
  const outputDir = getMiyaModelPath(projectDir, 'sheng yin', 'lin shi');
  const outputPath = path.join(outputDir, `tts-${Date.now()}.${format}`);
  const profileDir = path.join(
    getMiyaRuntimeDir(projectDir),
    'profiles',
    'companion',
    'current',
  );
  let tts: {
    outputPath: string;
    tier: 'lora' | 'embedding' | 'reference';
    degraded: boolean;
    message: string;
  };
  if (useMultimodalTestMode(projectDir)) {
    tts = {
      outputPath,
      tier: 'reference',
      degraded: true,
      message: 'python_runtime_not_ready:test_mode',
    };
  } else {
    try {
      tts = await daemon.runSovitsTts({
        text,
        outputPath,
        profileDir,
        voice,
        format,
      });
    } catch (error) {
      const updateTarget = parseModelUpdateTarget(error);
      if (updateTarget) {
        let pending = 'unknown';
        try {
          const plan = (await daemon.getModelUpdatePlan(updateTarget)) as {
            pending?: number;
          };
          if (typeof plan?.pending === 'number') pending = String(plan.pending);
        } catch {}
        throw new Error(
          `model_metadata_mismatch_blocked:${updateTarget}:run daemon.model.update.plan + daemon.model.update.apply:pending=${pending}`,
        );
      }
      if (!isRuntimeNotReadyError(error)) throw error;
      tts = {
        outputPath,
        tier: 'reference',
        degraded: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const wavBase64 = toBase64FromFile(tts.outputPath) ?? buildSilentWavBase64(estDurationMs);

  const media = ingestMedia(projectDir, {
    source: 'multimodal.voice.output',
    kind: 'audio',
    mimeType,
    fileName: `tts-${Date.now()}.${format}`,
    contentBase64: wavBase64,
    sizeBytes: Math.floor((wavBase64.length * 3) / 4),
    metadata: {
      status: tts.message.startsWith('python_runtime_not_ready:')
        ? 'degraded_runtime_not_ready'
        : 'generated_local',
      text,
      voice,
      model,
      format,
      tier: tts.tier,
      degraded: tts.degraded,
      engineMessage: tts.message,
      payloadCodec: 'pcm_s16le',
      estimatedDurationMs: estDurationMs,
      runtimeError: tts.message.startsWith('python_runtime_not_ready:') ? tts.message : undefined,
      createdBy: 'miya_voice_output',
    },
  });

  appendVoiceHistory(projectDir, {
    text,
    source: 'talk',
    mediaID: media.id,
  });

  if (input.registerAsCompanionAsset) {
    addCompanionAsset(projectDir, {
      type: 'audio',
      pathOrUrl: media.localPath ?? media.fileName,
      label: `voice:${voice}`,
    });
  }

  return {
    media,
    voice,
    model,
    format,
  };
}
