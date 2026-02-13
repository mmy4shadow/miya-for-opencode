import { addCompanionAsset } from '../companion/store';
import { getMiyaDaemonService } from '../daemon';
import { getMediaItem, ingestMedia } from '../media/store';
import type { GenerateImageInput, GenerateImageResult } from './types';

const DEFAULT_IMAGE_MODEL = 'local:flux.1-schnell';
const DEFAULT_IMAGE_SIZE = '1024x1024';
const BLANK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6sYz0AAAAASUVORK5CYII=';

function sanitizePrompt(prompt: string): string {
  return prompt.trim().slice(0, 2000);
}

export async function generateImage(
  projectDir: string,
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const daemon = getMiyaDaemonService(projectDir);
  const { result } = await daemon.runTask(
    {
      kind: 'image.generate',
      resource: {
        priority: 100,
        vramMB: 1024,
        modelID: input.model?.trim() || DEFAULT_IMAGE_MODEL,
        modelVramMB: 2048,
      },
      metadata: {
        stage: 'multimodal.image.generate',
      },
    },
    async () => {
      const prompt = sanitizePrompt(input.prompt);
      if (!prompt) throw new Error('invalid_prompt');

      const model = input.model?.trim() || DEFAULT_IMAGE_MODEL;
      const size = input.size?.trim() || DEFAULT_IMAGE_SIZE;
      const referenceMediaIDs = (input.referenceMediaIDs ?? []).filter(Boolean);
      const references = referenceMediaIDs
        .map((id) => getMediaItem(projectDir, id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => ({
          id: item.id,
          fileName: item.fileName,
          mimeType: item.mimeType,
          localPath: item.localPath,
        }));

      const media = ingestMedia(projectDir, {
        source: 'multimodal.image.generate',
        kind: 'image',
        mimeType: 'image/png',
        fileName: `generated-${Date.now()}.png`,
        contentBase64: BLANK_PNG_BASE64,
        sizeBytes: Math.floor((BLANK_PNG_BASE64.length * 3) / 4),
        metadata: {
          status: 'generated_local',
          prompt,
          model,
          size,
          references,
          createdBy: 'miya_generate_image',
        },
      });

      if (input.registerAsCompanionAsset) {
        addCompanionAsset(projectDir, {
          type: 'image',
          pathOrUrl: media.localPath ?? media.fileName,
          label: `generated:${model}`,
        });
      }

      return {
        media,
        model,
        size,
        prompt,
      };
    },
  );
  return result;
}
