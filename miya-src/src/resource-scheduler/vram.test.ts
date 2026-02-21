import { describe, expect, test } from 'vitest';
import { calculateVramBudget, decideModelSwapAction } from './vram';

describe('vram budget', () => {
  test('calculates overflow and degrade suggestion', () => {
    const budget = calculateVramBudget({
      snapshot: {
        timestamp: new Date().toISOString(),
        totalVramMB: 4096,
        safetyMarginMB: 512,
        usedVramMB: 1024,
        activeTasks: 1,
        queueDepth: 0,
        loadedModels: [
          {
            modelID: 'old-model',
            vramMB: 1536,
            pins: 0,
            lastUsedAt: new Date().toISOString(),
          },
        ],
      },
      task: {
        taskID: 'image.generate',
        taskVramMB: 1400,
      },
      models: [
        {
          modelID: 'local:flux.1-schnell',
          vramMB: 2300,
          required: true,
        },
      ],
    });
    expect(budget.fit).toBe(false);
    expect(budget.overflowMB).toBeGreaterThan(0);
    expect(
      decideModelSwapAction({
        currentModelID: 'old-model',
        targetModelID: 'local:flux.1-schnell',
        budget,
      }),
    ).toBe('evict_then_load');
  });
});
