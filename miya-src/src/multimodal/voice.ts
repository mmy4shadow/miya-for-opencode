import { addCompanionAsset } from '../companion/store';
import { getMediaItem, ingestMedia } from '../media/store';
import { appendVoiceHistory } from '../voice/state';
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

export function synthesizeVoiceOutput(
  projectDir: string,
  input: VoiceOutputInput,
): VoiceOutputResult {
  const text = input.text.trim();
  if (!text) throw new Error('invalid_tts_text');

  const voice = input.voice?.trim() || DEFAULT_VOICE;
  const model = input.model?.trim() || DEFAULT_TTS_MODEL;
  const format = normalizeFormat(input.format);
  const mimeType =
    format === 'mp3' ? 'audio/mpeg' : format === 'ogg' ? 'audio/ogg' : 'audio/wav';

  const media = ingestMedia(projectDir, {
    source: 'multimodal.voice.output',
    kind: 'audio',
    mimeType,
    fileName: `tts-${Date.now()}.${format}`,
    metadata: {
      status: 'generated_stub',
      text,
      voice,
      model,
      format,
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

