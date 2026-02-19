import * as fs from 'node:fs';
import * as path from 'node:path';
import { addCompanionAsset } from '../companion/store';
import { getMiyaClient } from '../daemon';
import { getMediaItem, ingestMedia } from '../media/store';
import { getMiyaImageTempDir } from '../model/paths';
import { getMiyaRuntimeDir } from '../workflow';
import type { GenerateImageInput, GenerateImageResult } from './types';

const DEFAULT_IMAGE_MODEL = 'local:flux.1-schnell';
const DEFAULT_IMAGE_SIZE = '1024x1024';
const MULTIMODAL_TEST_MODE_ENV = 'MIYA_MULTIMODAL_TEST_MODE';
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

function parseModelUpdateTarget(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!message.startsWith('model_update_required:')) return null;
  const [, target] = message.split(':');
  const normalized = String(target ?? '').trim();
  return normalized || null;
}

function useMultimodalTestMode(): boolean {
  const raw = String(process.env[MULTIMODAL_TEST_MODE_ENV] ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export async function generateImage(
  projectDir: string,
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const daemon = getMiyaClient(projectDir);
  const prompt = sanitizePrompt(input.prompt);
  if (!prompt) throw new Error('invalid_prompt:prompt must not be empty');

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
  const outputDir = getMiyaImageTempDir(projectDir);
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
  if (useMultimodalTestMode()) {
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
        model,
        references: references
          .map((item) => item.localPath)
          .filter((item): item is string => Boolean(item)),
        size,
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
      inference = {
        outputPath,
        tier: 'reference',
        degraded: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const generatedBase64 = toBase64FromFile(inference.outputPath);
  if (
    !generatedBase64 &&
    !inference.message.startsWith('python_runtime_not_ready:')
  ) {
    throw new Error(`image_generate_output_missing:${inference.message}`);
  }
  const payloadBase64 = generatedBase64 ?? BLANK_PNG_BASE64;

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
