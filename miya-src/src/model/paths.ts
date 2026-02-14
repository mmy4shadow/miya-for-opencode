import * as path from 'node:path';

const MODEL_ROOT_ENV = 'MIYA_MODEL_ROOT_DIR';

function normalizeModelRoot(projectDir: string, root: string): string {
  const trimmed = root.trim();
  if (!trimmed) return path.join(projectDir, 'miya', 'model');
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.normalize(path.join(projectDir, trimmed));
}

export function getMiyaModelRootDir(projectDir: string): string {
  const envRoot = process.env[MODEL_ROOT_ENV];
  if (typeof envRoot === 'string' && envRoot.trim()) {
    return normalizeModelRoot(projectDir, envRoot);
  }
  return path.join(projectDir, 'miya', 'model');
}

export function getMiyaModelPath(projectDir: string, ...segments: string[]): string {
  return path.join(getMiyaModelRootDir(projectDir), ...segments);
}
