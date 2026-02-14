import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ResourceScheduler } from './scheduler';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-resource-scheduler-test-'));
}

describe('resource scheduler', () => {
  test('prioritizes higher priority requests in queue', async () => {
    const scheduler = new ResourceScheduler(tempProjectDir(), {
      totalVramMB: 8192,
      safetyMarginMB: 256,
      maxConcurrentTasks: 1,
    });

    const firstLease = await scheduler.acquire({
      kind: 'generic',
      priority: 10,
      vramMB: 128,
    });

    const grantOrder: string[] = [];
    const lowPromise = scheduler.acquire({
      kind: 'generic',
      priority: 1,
      vramMB: 128,
    });
    lowPromise.then(() => {
      grantOrder.push('low');
    });
    const highPromise = scheduler.acquire({
      kind: 'generic',
      priority: 100,
      vramMB: 128,
    });
    highPromise.then(() => {
      grantOrder.push('high');
    });

    firstLease.release();
    const highLease = await highPromise;
    highLease.release();
    const lowLease = await lowPromise;
    lowLease.release();

    expect(grantOrder[0]).toBe('high');
    expect(grantOrder[1]).toBe('low');
  });

  test('foreground interaction request preempts queued training and recovers quickly', async () => {
    const scheduler = new ResourceScheduler(tempProjectDir(), {
      totalVramMB: 8192,
      safetyMarginMB: 256,
      maxConcurrentTasks: 1,
    });
    const blocker = await scheduler.acquire({
      kind: 'training.image',
      priority: 10,
      vramMB: 512,
    });

    const training = scheduler.acquire({
      kind: 'training.voice',
      priority: 5,
      vramMB: 256,
    });
    const t0 = Date.now();
    const foreground = scheduler.acquire({
      kind: 'generic',
      priority: 100,
      vramMB: 128,
    });
    blocker.release();
    const fgLease = await foreground;
    const recoveryMs = Date.now() - t0;
    fgLease.release();
    const trainingLease = await training;
    trainingLease.release();

    expect(recoveryMs).toBeLessThan(120);
  });

  test('evicts least-recently-used models when VRAM is tight', async () => {
    const scheduler = new ResourceScheduler(tempProjectDir(), {
      totalVramMB: 3000,
      safetyMarginMB: 0,
      maxConcurrentTasks: 1,
    });

    await scheduler.withLease(
      {
        kind: 'image.generate',
        vramMB: 200,
        modelID: 'model-a',
        modelVramMB: 1200,
      },
      () => undefined,
    );
    await scheduler.withLease(
      {
        kind: 'voice.tts',
        vramMB: 200,
        modelID: 'model-b',
        modelVramMB: 1200,
      },
      () => undefined,
    );
    await scheduler.withLease(
      {
        kind: 'vision.analyze',
        vramMB: 200,
        modelID: 'model-c',
        modelVramMB: 1200,
      },
      () => undefined,
    );

    const snapshot = scheduler.snapshot();
    expect(snapshot.loadedModels.some((item) => item.modelID === 'model-c')).toBe(true);
    expect(snapshot.loadedModels.length).toBeLessThanOrEqual(2);
  });
});
