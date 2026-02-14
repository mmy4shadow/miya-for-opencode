import { getMiyaDaemonService } from '../daemon';
import { getMediaItem } from '../media/store';
import { readOcrCoordinateCache, writeOcrCoordinateCache } from './ocr-cache';
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

export async function analyzeVision(
  projectDir: string,
  input: VisionAnalyzeInput,
): Promise<VisionAnalyzeResult> {
  const cacheHit = readOcrCoordinateCache(projectDir, {
    mediaID: input.mediaID,
    question: input.question,
  });
  if (cacheHit) {
    return {
      mediaID: cacheHit.mediaID,
      summary: cacheHit.summary,
      details: {
        cacheHit: true,
        ocrBoxes: cacheHit.boxes,
      },
    };
  }

  const daemon = getMiyaDaemonService(projectDir);
  const { result } = await daemon.runTask(
    {
      kind: 'vision.analyze',
      resource: {
        priority: 90,
        vramMB: 768,
        modelID: 'local:qwen3-vl-4b',
        modelVramMB: 1536,
      },
      metadata: {
        stage: 'multimodal.vision.analyze',
        mediaID: input.mediaID,
      },
    },
    async () => {
      const media = getMediaItem(projectDir, input.mediaID);
      if (!media) throw new Error('media_not_found');
      if (media.kind !== 'image') throw new Error('invalid_vision_media_kind');

      const summary = summarizeFromMetadata(media.metadata);
      const ocrBoxes = [
        {
          x: 24,
          y: 24,
          width: 320,
          height: 72,
          text: String(media.metadata?.caption ?? summary).slice(0, 120),
        },
      ];
      const finalSummary =
        input.question && input.question.trim()
          ? `${summary} | question: ${input.question.trim()}`
          : summary;
      writeOcrCoordinateCache(projectDir, {
        mediaID: media.id,
        question: input.question,
        boxes: ocrBoxes,
        summary: finalSummary,
      });
      return {
        mediaID: media.id,
        summary: finalSummary,
        details: {
          cacheHit: false,
          ocrBoxes,
          fileName: media.fileName,
          mimeType: media.mimeType,
          localPath: media.localPath,
          metadata: media.metadata ?? {},
        },
      };
    },
  );
  return result;
}
