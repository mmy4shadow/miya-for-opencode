import type { MediaItem } from '../media/store';

export interface GenerateImageInput {
  prompt: string;
  referenceMediaIDs?: string[];
  model?: string;
  size?: string;
  registerAsCompanionAsset?: boolean;
}

export interface GenerateImageResult {
  media: MediaItem;
  model: string;
  size: string;
  prompt: string;
}

export interface VoiceInputIngest {
  text?: string;
  mediaID?: string;
  source?: 'wake' | 'talk' | 'manual' | 'media';
  language?: string;
}

export interface VoiceInputResult {
  text: string;
  source: 'wake' | 'talk' | 'manual' | 'media';
  mediaID?: string;
}

export interface VoiceOutputInput {
  text: string;
  voice?: string;
  model?: string;
  format?: 'wav' | 'mp3' | 'ogg';
  registerAsCompanionAsset?: boolean;
}

export interface VoiceOutputResult {
  media: MediaItem;
  voice: string;
  model: string;
  format: 'wav' | 'mp3' | 'ogg';
}

export interface VisionAnalyzeInput {
  mediaID: string;
  question?: string;
}

export interface VisionAnalyzeResult {
  mediaID: string;
  summary: string;
  details: Record<string, unknown>;
}
