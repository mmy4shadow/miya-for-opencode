import { addCompanionAsset } from '../companion/store';
import { getMiyaClient } from '../daemon';
import { getMediaItem, ingestMedia } from '../media/store';
import { getMiyaModelPath } from '../model/paths';
import { readConfig } from '../settings';
import { getMiyaRuntimeDir } from '../workflow';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GenerateImageInput, GenerateImageResult } from './types';

const DEFAULT_IMAGE_MODEL = 'local:flux.1-schnell';
const DEFAULT_IMAGE_SIZE = '1024x1024';
const BLANK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6sYz0AAAAASUVORK5CYII=';

function sanitizePrompt(prompt: string): string {
  return prompt.trim().slice(0, 2000);
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

function useMultimodalTestMode(projectDir: string): boolean {
  if (process.env.MIYA_MULTIMODAL_TEST_MODE === '1') return true;
  const config = readConfig(projectDir);
  const runtime = config.runtime as Record<string, unknown> | undefined;
  const multimodal = runtime?.multimodal as Record<string, unknown> | undefined;
  return multimodal?.test_mode === true;
}

export async function generateImage(
  projectDir: string,
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const daemon = getMiyaClient(projectDir);
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
  const outputDir = getMiyaModelPath(projectDir, 'tu pian', 'lin shi');
  const outputPath = path.join(outputDir, `flux-${Date.now()}.png`);
  const profileDir = path.join(
    getMiyaRuntimeDir(projectDir),
    'profiles',
    'companion',
    'current',
  );
  let inference: {
    outputPath: string;
    tier: 'lora' | 'embedding' | 'reference';
    degraded: boolean;
    message: string;
  };
  if (useMultimodalTestMode(projectDir)) {
    inference = {
      outputPath,
      tier: 'reference',
      degraded: true,
      message: 'python_runtime_not_ready:test_mode',
    };
  } else {
    try {
      inference = await daemon.runFluxImageGenerate({
        prompt,
        outputPath,
        profileDir,
        references: references
          .map((item) => item.localPath)
          .filter((item): item is string => Boolean(item)),
        size,
      });
    } catch (error) {
      if (!isRuntimeNotReadyError(error)) throw error;
      inference = {
        outputPath,
        tier: 'reference',
        degraded: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const payloadBase64 = toBase64FromFile(inference.outputPath) ?? BLANK_PNG_BASE64;

  const media = ingestMedia(projectDir, {
    source: 'multimodal.image.generate',
    kind: 'image',
    mimeType: 'image/png',
    fileName: `generated-${Date.now()}.png`,
    contentBase64: payloadBase64,
    sizeBytes: Math.floor((payloadBase64.length * 3) / 4),
    metadata: {
      status: inference.message.startsWith('python_runtime_not_ready:')
        ? 'degraded_runtime_not_ready'
        : 'generated_local',
      prompt,
      model,
      size,
      tier: inference.tier,
      degraded: inference.degraded,
      engineMessage: inference.message,
      runtimeError: inference.message.startsWith('python_runtime_not_ready:')
        ? inference.message
        : undefined,
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
}
