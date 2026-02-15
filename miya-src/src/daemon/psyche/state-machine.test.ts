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
});
