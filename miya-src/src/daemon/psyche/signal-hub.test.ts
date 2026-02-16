import { describe, expect, test } from 'bun:test';
import { PsycheNativeSignalHub } from './signal-hub';

describe('psyche native signal hub', () => {
  test('collects on demand when no timer is running', () => {
    let calls = 0;
    const hub = new PsycheNativeSignalHub({
      collector: () => {
        calls += 1;
        return {
          sampledAt: new Date(1_700_000_000_000 + calls).toISOString(),
          signals: { foreground: 'ide', idleSec: calls },
          captureLimitations: [],
        };
      },
      sampleIntervalMs: 60_000,
      staleAfterMs: 60_000,
    });
    const first = hub.readSnapshot();
    const second = hub.readSnapshot();
    expect(calls).toBe(1);
    expect(first.signals.idleSec).toBe(1);
    expect(second.signals.idleSec).toBe(1);
  });

  test('runs periodic refresh loop and keeps latest sample', async () => {
    let calls = 0;
    const hub = new PsycheNativeSignalHub({
      collector: () => {
        calls += 1;
        return {
          sampledAt: new Date(1_700_000_100_000 + calls).toISOString(),
          signals: {
            foreground: calls % 2 === 0 ? 'browser' : 'ide',
            idleSec: calls,
          },
          captureLimitations: [],
        };
      },
      sampleIntervalMs: 40,
      burstIntervalMs: 15,
      staleAfterMs: 300,
      burstCyclesOnChange: 2,
    });
    hub.start();
    await Bun.sleep(420);
    hub.stop();
    const snapshot = hub.readSnapshot();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(Number(snapshot.signals.idleSec ?? 0)).toBeGreaterThanOrEqual(2);
  });

  test('returns previous sample with limitation when collector fails', async () => {
    let calls = 0;
    const hub = new PsycheNativeSignalHub({
      collector: () => {
        calls += 1;
        if (calls === 1) {
          return {
            sampledAt: new Date(1_700_000_200_000).toISOString(),
            signals: { foreground: 'ide', idleSec: 1 },
            captureLimitations: [],
          };
        }
        throw new Error('boom');
      },
      sampleIntervalMs: 200,
      staleAfterMs: 200,
    });
    const warm = hub.readSnapshot();
    await Bun.sleep(240);
    const fallback = hub.readSnapshot();
    expect(warm.signals.foreground).toBe('ide');
    expect(fallback.signals.foreground).toBe('ide');
    expect(
      (fallback.captureLimitations ?? []).some((item) => item.includes('signal_hub_collect_failed')),
    ).toBe(true);
  });
});
