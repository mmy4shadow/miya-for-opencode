import { describe, expect, test } from 'bun:test';
import { inferSentinelState } from './state-machine';

describe('psyche sentinel state machine', () => {
  test('detects consume when fullscreen media is active', () => {
    const state = inferSentinelState({
      idleSec: 120,
      foreground: 'browser',
      fullscreen: true,
      audioActive: true,
    });
    expect(state.state).toBe('CONSUME');
    expect(state.confidence).toBeGreaterThan(0.8);
  });

  test('does not mark away when gamepad is active', () => {
    const state = inferSentinelState({
      idleSec: 800,
      foreground: 'other',
      gamepadActive: true,
    });
    expect(state.state).toBe('PLAY');
  });

  test('requires probe when game foreground is idle without input signals', () => {
    const state = inferSentinelState({
      idleSec: 400,
      foreground: 'game',
      gamepadActive: false,
      audioActive: false,
    });
    expect(state.state).toBe('UNKNOWN');
    expect(state.shouldProbeScreen).toBe(true);
  });

  test('falls back to unknown when screen probe fails under media signal', () => {
    const state = inferSentinelState({
      idleSec: 140,
      foreground: 'browser',
      fullscreen: true,
      audioActive: true,
      screenProbe: 'black',
    });
    expect(state.state).toBe('UNKNOWN');
    expect(state.reasons.join(',')).toContain('screen_probe_black');
  });

  test('falls back to unknown when screen probe fails without media signal', () => {
    const state = inferSentinelState({
      idleSec: 420,
      foreground: 'other',
      fullscreen: false,
      audioActive: false,
      screenProbe: 'timeout',
    });
    expect(state.state).toBe('UNKNOWN');
    expect(state.reasons.join(',')).toContain('screen_probe_timeout');
    expect(state.reasons.join(',')).toContain('probe_failed_fallback_unknown');
  });

  test('marks protected capture limits when probe returns black frame', () => {
    const state = inferSentinelState({
      idleSec: 160,
      foreground: 'browser',
      fullscreen: true,
      audioActive: true,
      screenProbe: 'black',
      captureLimitations: ['drm_protected'],
    });
    expect(state.state).toBe('UNKNOWN');
    expect(state.reasons.join(',')).toContain('screen_probe_capture_protected');
  });

  test('falls back to unknown on conflicting idle and input signals', () => {
    const state = inferSentinelState({
      idleSec: 240,
      foreground: 'other',
      rawInputActive: true,
      windowSwitchPerMin: 12,
    });
    expect(state.state).toBe('UNKNOWN');
    expect(state.reasons.join(',')).toContain('input_signal_conflict');
  });
});
