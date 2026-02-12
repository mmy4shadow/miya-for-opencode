export interface MediaTranscribeRequest {
  mediaID: string;
  language?: string;
}

export interface MediaTranscribeResult {
  mediaID: string;
  transcript: string;
  confidence?: number;
}

export function buildTranscribeRequestedEvent(input: MediaTranscribeRequest) {
  return {
    event: 'media.transcribe.request',
    payload: input,
  };
}

export function buildTranscribeDoneEvent(input: MediaTranscribeResult) {
  return {
    event: 'media.transcribe.done',
    payload: input,
  };
}
