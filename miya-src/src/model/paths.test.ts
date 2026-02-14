import { afterEach, describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { getMiyaModelPath, getMiyaModelRootDir } from './paths';

const originalEnv = process.env.MIYA_MODEL_ROOT_DIR;

afterEach(() => {
  if (typeof originalEnv === 'string') {
    process.env.MIYA_MODEL_ROOT_DIR = originalEnv;
  } else {
    delete process.env.MIYA_MODEL_ROOT_DIR;
  }
});

describe('model path resolver', () => {
  test('uses project/miya/model by default', () => {
    delete process.env.MIYA_MODEL_ROOT_DIR;
    const root = getMiyaModelRootDir('/repo/workspace');
    expect(root).toBe(path.join('/repo/workspace', 'miya', 'model'));
    expect(getMiyaModelPath('/repo/workspace', 'tu pian', 'lin shi')).toBe(
      path.join('/repo/workspace', 'miya', 'model', 'tu pian', 'lin shi'),
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
});
