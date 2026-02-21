import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { getMiyaRuntimeDir } from '../workflow';
import { AudioFillerController } from './audio-filler';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-audio-filler-'));
}

function writeWakeWords(
  projectDir: string,
  rows: Array<{
    text: string;
    path?: string;
    weight?: number;
    tags?: string[];
  }>,
): void {
  const dir = path.join(
    getMiyaRuntimeDir(projectDir),
    'model',
    'sheng_yin',
    'cache',
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'wake_words.json'),
    `${JSON.stringify(rows, null, 2)}\n`,
    'utf-8',
  );
}

describe('audio filler adaptive cues', () => {
  test('uses adaptive wake-word cue when tag matches task kind', () => {
    const projectDir = tempProjectDir();
    const clipDir = path.join(
      getMiyaRuntimeDir(projectDir),
      'model',
      'sheng_yin',
      'cache',
    );
    fs.mkdirSync(clipDir, { recursive: true });
    fs.writeFileSync(path.join(clipDir, 'work.wav'), 'fake', 'utf-8');
    writeWakeWords(projectDir, [
      {
        text: '我在处理你的编码任务。',
        path: 'work.wav',
        weight: 5,
        tags: ['work'],
      },
      { text: '我在看图像。', weight: 1, tags: ['creative'] },
    ]);

    const controller = new AudioFillerController(projectDir, {
      random: () => 0,
    });
    const decision = controller.decide({ kind: 'shell.exec' });

    expect(decision.shouldFill).toBe(true);
    expect(decision.cue?.text).toBe('我在处理你的编码任务。');
    expect(
      decision.cue?.clipPath?.endsWith(path.join('cache', 'work.wav')),
    ).toBe(true);
    expect(decision.cue?.source).toBe('asset');
  });

  test('avoids repeating the same adaptive cue when alternatives exist', () => {
    const projectDir = tempProjectDir();
    writeWakeWords(projectDir, [
      { text: '我先看一下。', weight: 1, tags: ['analysis'] },
      { text: '让我再确认一遍。', weight: 1, tags: ['analysis'] },
    ]);

    const controller = new AudioFillerController(projectDir, {
      random: () => 0,
    });
    const first = controller.decide({ kind: 'vision.analyze' });
    const second = controller.decide({ kind: 'vision.analyze' });

    expect(first.shouldFill).toBe(true);
    expect(second.shouldFill).toBe(true);
    expect(first.cue?.text).toBe('我先看一下。');
    expect(second.cue?.text).toBe('让我再确认一遍。');
  });
});
