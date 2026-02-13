import { getMediaItem } from '../media/store';
import type { VisionAnalyzeInput, VisionAnalyzeResult } from './types';

function summarizeFromMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return 'No metadata available for vision summary.';
  const caption =
    typeof metadata.caption === 'string'
      ? metadata.caption
      : typeof metadata.description === 'string'
        ? metadata.description
        : '';
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((item) => typeof item === 'string').join(', ')
    : '';
  if (caption && tags) return `${caption} (tags: ${tags})`;
  if (caption) return caption;
  if (tags) return `tags: ${tags}`;
  return 'Image metadata found but no caption/tags were provided.';
}

export function analyzeVision(
  projectDir: string,
  input: VisionAnalyzeInput,
): VisionAnalyzeResult {
  const media = getMediaItem(projectDir, input.mediaID);
  if (!media) throw new Error('media_not_found');
  if (media.kind !== 'image') throw new Error('invalid_vision_media_kind');

  const summary = summarizeFromMetadata(media.metadata);
  return {
    mediaID: media.id,
    summary:
      input.question && input.question.trim()
        ? `${summary} | question: ${input.question.trim()}`
        : summary,
    details: {
      fileName: media.fileName,
      mimeType: media.mimeType,
      localPath: media.localPath,
      metadata: media.metadata ?? {},
    },
  };
}

