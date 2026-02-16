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

  test('applies hydraulics tiers and offloads stale models', async () => {
    const prevHotset = process.env.MIYA_RESOURCE_HOTSET_MB;
    const prevWarmPool = process.env.MIYA_RESOURCE_WARMPOOL_MB;
    process.env.MIYA_RESOURCE_HOTSET_MB = '1300';
    process.env.MIYA_RESOURCE_WARMPOOL_MB = '1300';
    try {
      const scheduler = new ResourceScheduler(tempProjectDir(), {
        totalVramMB: 4096,
        safetyMarginMB: 0,
        maxConcurrentTasks: 1,
      });
      await scheduler.withLease(
        {
          kind: 'image.generate',
          vramMB: 100,
          modelID: 'hydra-a',
          modelVramMB: 1200,
        },
        () => undefined,
      );
      await scheduler.withLease(
        {
          kind: 'vision.analyze',
          vramMB: 100,
          modelID: 'hydra-b',
          modelVramMB: 1200,
        },
        () => undefined,
      );
      await scheduler.withLease(
        {
          kind: 'voice.tts',
          vramMB: 100,
          modelID: 'hydra-c',
          modelVramMB: 1200,
        },
        () => undefined,
      );
      const snapshot = scheduler.snapshot();
      expect(snapshot.hydraulics.hotsetLimitMB).toBeGreaterThan(0);
      expect(snapshot.hydraulics.offloadedModels.length).toBeGreaterThanOrEqual(1);
      expect(
        snapshot.loadedModels.every((item) => item.residency === 'hot' || item.residency === 'warm'),
      ).toBe(true);
    } finally {
      if (prevHotset === undefined) delete process.env.MIYA_RESOURCE_HOTSET_MB;
      else process.env.MIYA_RESOURCE_HOTSET_MB = prevHotset;
      if (prevWarmPool === undefined) delete process.env.MIYA_RESOURCE_WARMPOOL_MB;
      else process.env.MIYA_RESOURCE_WARMPOOL_MB = prevWarmPool;
    }
  });
});
