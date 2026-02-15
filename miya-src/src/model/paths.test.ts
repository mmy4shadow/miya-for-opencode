import { afterEach, describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import {
  getMiyaAutomationDir,
  getMiyaFluxModelDir,
  getMiyaModelPath,
  getMiyaModelRootDir,
  getMiyaSovitsModelDir,
  getMiyaVoiceprintModelDir,
  getMiyaVoiceprintSampleDir,
} from './paths';

const originalEnv = process.env.MIYA_MODEL_ROOT_DIR;

afterEach(() => {
  if (typeof originalEnv === 'string') {
    process.env.MIYA_MODEL_ROOT_DIR = originalEnv;
  } else {
    delete process.env.MIYA_MODEL_ROOT_DIR;
  }
});

describe('model path resolver', () => {
  test('uses project/.opencode/miya/model by default', () => {
    delete process.env.MIYA_MODEL_ROOT_DIR;
    const root = getMiyaModelRootDir('/repo/workspace');
    expect(root).toBe(path.join('/repo/workspace', '.opencode', 'miya', 'model'));
    expect(getMiyaModelPath('/repo/workspace', 'tu pian', 'lin shi')).toBe(
      path.join('/repo/workspace', '.opencode', 'miya', 'model', 'tu pian', 'lin shi'),
    );
  });

  test('supports absolute env override', () => {
    process.env.MIYA_MODEL_ROOT_DIR = path.join(path.sep, 'data', 'miya-models');
    expect(getMiyaModelRootDir('/repo/workspace')).toBe(path.join(path.sep, 'data', 'miya-models'));
  });

  test('supports project-relative env override', () => {
    process.env.MIYA_MODEL_ROOT_DIR = path.join('custom', 'models');
    expect(getMiyaModelRootDir('/repo/workspace')).toBe(
      path.join('/repo/workspace', 'custom', 'models'),
    );
  });

  test('keeps canonical automation/model layout helpers aligned', () => {
    delete process.env.MIYA_MODEL_ROOT_DIR;
    expect(getMiyaAutomationDir('/repo/workspace')).toBe(
      path.join('/repo/workspace', '.opencode', 'miya', 'automation'),
    );
    expect(getMiyaFluxModelDir('/repo/workspace')).toBe(
      path.join('/repo/workspace', '.opencode', 'miya', 'model', 'tu pian', 'FLUX.1 schnell'),
    );
    expect(getMiyaSovitsModelDir('/repo/workspace')).toBe(
      path.join(
        '/repo/workspace',
        '.opencode',
        'miya',
        'model',
        'sheng yin',
        'GPT-SoVITS-v2pro-20250604',
      ),
    );
    expect(getMiyaVoiceprintModelDir('/repo/workspace')).toBe(
      path.join('/repo/workspace', '.opencode', 'miya', 'model', 'shi bie', 'eres2net'),
    );
    expect(getMiyaVoiceprintSampleDir('/repo/workspace')).toBe(
      path.join('/repo/workspace', '.opencode', 'miya', 'model', 'shi bie', 'ben ren'),
    );
  });
});
