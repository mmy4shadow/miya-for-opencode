import { describe, expect, test } from 'bun:test';
import { buildProactivityContextVector } from './context-vector';
import { evaluateProactivityCounterfactual } from './counterfactual';
import { resolveProactivityPolicy } from './policy';

const baseContext = buildProactivityContextVector({
  atMs: Date.UTC(2026, 1, 19, 10, 0, 0),
  state: 'FOCUS',
  urgency: 'low',
  userInitiated: false,
  fastBrainScore: 0.55,
  resonanceScore: 0.52,
  trustMinScore: 80,
  trustTier: 'medium',
  risk: {
    falseIdleUncertain: false,
    drmCaptureBlocked: false,
    probeRateLimited: false,
    probeRequested: false,
  },
  signals: {
    idleSec: 10,
    apm: 120,
    windowSwitchPerMin: 12,
  },
  interaction: {
    generatedAtMs: Date.now(),
    window1h: {
      consults: 10,
      proactiveAllows: 4,
      proactiveDefers: 2,
      userInitiatedTurns: 2,
    },
    window24h: {
      consults: 50,
      proactiveAllows: 20,
      proactiveDefers: 10,
      userInitiatedTurns: 12,
      outcomes: 24,
      delivered: 16,
      negativeFeedback: 6,
      positiveFeedback: 3,
      replyRate: 0.35,
      medianReplySec: 210,
      userInitiatedRate: 0.24,
      negativeFeedbackRate: 0.25,
    },
  },
});

describe('proactivity policy', () => {
  test('counterfactual prefers waiting under focus pressure', () => {
    const scored = evaluateProactivityCounterfactual({
      state: 'FOCUS',
      urgency: 'low',
      baseDecision: 'allow',
      userInitiated: false,
      context: baseContext,
    });
    expect(scored.action).not.toBe('send_now');
    expect(scored.scoreWait).toBeGreaterThanOrEqual(scored.scoreNow);
  });

  test('policy converts allow to defer when waiting is preferred', () => {
    const result = resolveProactivityPolicy({
      at: new Date().toISOString(),
      intent: 'outbound.send.qq',
      channel: 'qq',
      userInitiated: false,
      urgency: 'low',
      state: 'FOCUS',
      baseDecision: 'allow',
      context: baseContext,
    });
    expect(result.decision).toBe('defer');
    expect(result.waitSec).toBeGreaterThan(0);
  });

  test('policy preserves deny hard gate', () => {
    const result = resolveProactivityPolicy({
      at: new Date().toISOString(),
      intent: 'outbound.send.qq',
      channel: 'qq',
      userInitiated: false,
      urgency: 'medium',
      state: 'UNKNOWN',
      baseDecision: 'deny',
      context: baseContext,
    });
    expect(result.decision).toBe('deny');
    expect(result.action).toBe('skip');
  });

  test('policy preserves critical allow as immediate send', () => {
    const result = resolveProactivityPolicy({
      at: new Date().toISOString(),
      intent: 'outbound.send.qq',
      channel: 'qq',
      userInitiated: false,
      urgency: 'critical',
      state: 'PLAY',
      baseDecision: 'allow',
      context: baseContext,
    });
    expect(result.decision).toBe('allow');
    expect(result.action).toBe('send_now');
    expect(result.waitSec).toBe(0);
  });
});
