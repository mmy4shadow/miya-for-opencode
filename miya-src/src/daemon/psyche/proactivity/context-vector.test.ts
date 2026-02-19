import { describe, expect, test } from 'bun:test';
import { buildProactivityContextVector } from './context-vector';

describe('proactivity context vector', () => {
  test('builds stable feature map and vector', () => {
    const result = buildProactivityContextVector({
      atMs: Date.UTC(2026, 1, 19, 14, 30, 0),
      state: 'FOCUS',
      urgency: 'medium',
      userInitiated: false,
      fastBrainScore: 0.62,
      resonanceScore: 0.57,
      trustMinScore: 78,
      trustTier: 'medium',
      risk: {
        falseIdleUncertain: false,
        drmCaptureBlocked: false,
        probeRateLimited: false,
        probeRequested: false,
      },
      signals: {
        idleSec: 25,
        apm: 92,
        windowSwitchPerMin: 5,
      },
      interaction: {
        generatedAtMs: Date.now(),
        window1h: {
          consults: 4,
          proactiveAllows: 1,
          proactiveDefers: 2,
          userInitiatedTurns: 1,
        },
        window24h: {
          consults: 20,
          proactiveAllows: 5,
          proactiveDefers: 8,
          userInitiatedTurns: 7,
          outcomes: 12,
          delivered: 8,
          negativeFeedback: 1,
          positiveFeedback: 3,
          replyRate: 0.75,
          medianReplySec: 96,
          userInitiatedRate: 0.35,
          negativeFeedbackRate: 0.08,
        },
      },
    });
    expect(result.vector.length).toBeGreaterThan(20);
    expect(result.featureMap.state_focus).toBe(1);
    expect(result.featureMap.urgency_medium).toBe(1);
    expect(result.featureMap.reply_rate_24h).toBe(0.75);
  });
});

