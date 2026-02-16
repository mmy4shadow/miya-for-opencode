import * as path from 'node:path';

const MODEL_ROOT_ENV = 'MIYA_MODEL_ROOT_DIR';
const MIYA_ROOT_SEGMENTS = ['.opencode', 'miya'] as const;

export const MIYA_MODEL_BRANCH = {
  vision: 'shi jue',
  image: 'tu pian',
  voiceprint: 'shi bie',
  voice: 'sheng yin',
} as const;

export const MIYA_MODEL_NAME = {
  qwen3vl: 'Qwen3VL-4B-Instruct-Q4_K_M',
  fluxSchnell: 'FLUX.1 schnell',
  fluxKlein: 'FLUX.2 [klein] 4B（Apache-2.0）',
  eres2net: 'eres2net',
  sovits: 'GPT-SoVITS-v2pro-20250604',
} as const;

function normalizeProjectDir(projectDir: string): string {
  return path.resolve(projectDir);
}

function isOpenCodeRoot(projectDir: string): boolean {
  return path.basename(projectDir).toLowerCase() === '.opencode';
}

function normalizeModelRoot(projectDir: string, root: string): string {
  const trimmed = root.trim();
  if (!trimmed) return path.join(getMiyaDataRootDir(projectDir), 'model');
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.normalize(path.join(projectDir, trimmed));
}

export function getMiyaDataRootDir(projectDir: string): string {
  const normalized = normalizeProjectDir(projectDir);
  if (isOpenCodeRoot(normalized)) {
    return path.join(normalized, 'miya');
  }
  return path.join(normalized, ...MIYA_ROOT_SEGMENTS);
}

export function getMiyaAutomationDir(projectDir: string): string {
  return path.join(getMiyaDataRootDir(projectDir), 'automation');
}

export function getMiyaModelRootDir(projectDir: string): string {
  const envRoot = process.env[MODEL_ROOT_ENV];
  if (typeof envRoot === 'string' && envRoot.trim()) {
    return normalizeModelRoot(projectDir, envRoot);
  }
  return path.join(getMiyaDataRootDir(projectDir), 'model');
}

export function getMiyaModelPath(projectDir: string, ...segments: string[]): string {
  return path.join(getMiyaModelRootDir(projectDir), ...segments);
}

export function getMiyaVisionTempDir(projectDir: string, ...segments: string[]): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.vision, 'lin shi', ...segments);
}

export function getMiyaVisionLongTermDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.vision, 'chang qi');
}

export function getMiyaImageTempDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.image, 'lin shi');
}

export function getMiyaImageLongTermDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.image, 'chang qi');
}

export function getMiyaVoiceTempDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.voice, 'lin shi');
}

export function getMiyaVoiceLongTermDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.voice, 'chang qi');
}

export function getMiyaFluxModelDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.image, MIYA_MODEL_NAME.fluxSchnell);
}

export function getMiyaFluxKleinModelDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.image, MIYA_MODEL_NAME.fluxKlein);
}

export function getMiyaQwen3VlModelDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.vision, MIYA_MODEL_NAME.qwen3vl);
}

export function getMiyaSovitsModelDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.voice, MIYA_MODEL_NAME.sovits);
}

export function getMiyaVoiceprintModelDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.voiceprint, MIYA_MODEL_NAME.eres2net);
}

export function getMiyaVoiceprintSampleDir(projectDir: string): string {
  return getMiyaModelPath(projectDir, MIYA_MODEL_BRANCH.voiceprint, 'ben ren');
}
