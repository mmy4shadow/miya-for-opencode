export interface MediaTranscribeRequest {
  mediaID: string;
  language?: string;
}

export interface MediaTranscribeResult {
  mediaID: string;
  transcript: string;
  confidence?: number;
}

function normalizeMediaID(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTranscript(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

export function buildTranscribeRequestedEvent(input: MediaTranscribeRequest) {
  const mediaID = normalizeMediaID(input.mediaID);
  if (!mediaID) {
    throw new Error('invalid_media_transcribe_request:mediaID is required');
  }
  return {
    event: 'media.transcribe.request',
    payload: {
      mediaID,
      language: normalizeLanguage(input.language),
    },
  };
}

export function buildTranscribeDoneEvent(input: MediaTranscribeResult) {
  const mediaID = normalizeMediaID(input.mediaID);
  if (!mediaID) {
    throw new Error('invalid_media_transcribe_result:mediaID is required');
  }
  const transcript = normalizeTranscript(input.transcript);
  if (!transcript) {
    throw new Error(
      'invalid_media_transcribe_result:transcript must not be empty',
    );
  }
  return {
    event: 'media.transcribe.done',
    payload: {
      mediaID,
      transcript,
      confidence: normalizeConfidence(input.confidence),
    },
  };
}
