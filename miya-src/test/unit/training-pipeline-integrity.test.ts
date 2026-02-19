import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-training-pipeline-test-'));
}

function pythonCommand(): string {
  return process.env.PYTHON || 'python';
}

function projectRoot(): string {
  return path.resolve(import.meta.dir, '..', '..');
}

describe('training pipeline security and integrity', () => {
  test('train_sovits tolerates invalid numeric env overrides without bootstrap crash', () => {
    const projectDir = tempProjectDir();
    const outputPath = path.join(projectDir, 'voice-model.json');
    const proc = Bun.spawnSync(
      [
        pythonCommand(),
        'python/train_sovits.py',
        '--dry-run',
        '--audio-file',
        path.join(projectDir, 'sample.wav'),
        '--text',
        'hello',
        '--output-path',
        outputPath,
      ],
      {
        cwd: projectRoot(),
        env: {
          ...process.env,
          MIYA_TRAIN_STEPS: 'not-a-number',
          MIYA_TRAIN_RESUME_STEP: 'bad',
          MIYA_LR: 'oops',
          MIYA_GPU_LOG_INTERVAL: 'bad-value',
        },
      },
    );

    expect(proc.exitCode).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  test('train_flux_lora tolerates invalid numeric env overrides without bootstrap crash', () => {
    const projectDir = tempProjectDir();
    const imagesDir = path.join(projectDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, 'sample.txt'), 'placeholder', 'utf-8');
    const outputPath = path.join(projectDir, 'lora.safetensors');

    const proc = Bun.spawnSync(
      [
        pythonCommand(),
        'python/train_flux_lora.py',
        '--dry-run',
        '--images-dir',
        imagesDir,
        '--output-path',
        outputPath,
      ],
      {
        cwd: projectRoot(),
        env: {
          ...process.env,
          MIYA_TRAIN_STEPS: 'NaN',
          MIYA_BATCH_SIZE: 'broken',
          MIYA_LR: 'broken',
          MIYA_CHECKPOINT_INTERVAL: 'invalid',
        },
      },
    );

    expect(proc.exitCode).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
  });
});
