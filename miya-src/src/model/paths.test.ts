import { afterEach, describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import {
  getMiyaAutomationDir,
  getMiyaFluxModelDir,
  getMiyaModelPath,
  getMiyaModelRootDir,
  getMiyaQwen3VlModelDir,
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
    const projectDir = path.resolve(path.sep, 'repo', 'workspace');
    const root = getMiyaModelRootDir(projectDir);
    expect(root).toBe(path.join(projectDir, '.opencode', 'miya', 'model'));
    expect(getMiyaModelPath(projectDir, 'tu pian', 'lin shi')).toBe(
      path.join(projectDir, '.opencode', 'miya', 'model', 'tu pian', 'lin shi'),
    );
  });

  test('uses project/miya/model when project dir already points to .opencode root', () => {
    delete process.env.MIYA_MODEL_ROOT_DIR;
    const projectDir = path.resolve(path.sep, 'repo', '.opencode');
    const root = getMiyaModelRootDir(projectDir);
    expect(root).toBe(path.join(projectDir, 'miya', 'model'));
    expect(getMiyaQwen3VlModelDir(projectDir)).toBe(
      path.join(projectDir, 'miya', 'model', 'shi jue', 'Qwen3VL-4B-Instruct-Q4_K_M'),
    );
  });

  test('supports absolute env override', () => {
    process.env.MIYA_MODEL_ROOT_DIR = path.join(path.sep, 'data', 'miya-models');
    expect(getMiyaModelRootDir(path.resolve(path.sep, 'repo', 'workspace'))).toBe(
      path.join(path.sep, 'data', 'miya-models'),
    );
  });

  test('supports project-relative env override', () => {
    process.env.MIYA_MODEL_ROOT_DIR = path.join('custom', 'models');
    const projectDir = path.resolve(path.sep, 'repo', 'workspace');
    expect(getMiyaModelRootDir(projectDir)).toBe(
      path.join(projectDir, 'custom', 'models'),
    );
  });

  test('keeps canonical automation/model layout helpers aligned', () => {
    delete process.env.MIYA_MODEL_ROOT_DIR;
    const projectDir = path.resolve(path.sep, 'repo', 'workspace');
    expect(getMiyaAutomationDir(projectDir)).toBe(
      path.join(projectDir, '.opencode', 'miya', 'automation'),
    );
    expect(getMiyaFluxModelDir(projectDir)).toBe(
      path.join(projectDir, '.opencode', 'miya', 'model', 'tu pian', 'FLUX.1 schnell'),
    );
    expect(getMiyaSovitsModelDir(projectDir)).toBe(
      path.join(
        projectDir,
        '.opencode',
        'miya',
        'model',
        'sheng yin',
        'GPT-SoVITS-v2pro-20250604',
      ),
    );
    expect(getMiyaVoiceprintModelDir(projectDir)).toBe(
      path.join(projectDir, '.opencode', 'miya', 'model', 'shi bie', 'eres2net'),
    );
    expect(getMiyaVoiceprintSampleDir(projectDir)).toBe(
      path.join(projectDir, '.opencode', 'miya', 'model', 'shi bie', 'ben ren'),
    );
  });
});
