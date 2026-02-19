import { describe, expect, test } from 'bun:test';
import { normalizeTrustMode } from '../../src/gateway';

describe('approval fatigue silent threshold enforcement', () => {
  test('keeps toast_gate window reachable when thresholds overlap', () => {
    const mode = normalizeTrustMode({
      silentMin: 60,
      modalMax: 80,
    });
    expect(mode.silentMin).toBeGreaterThan(mode.modalMax);
    expect(mode.silentMin - mode.modalMax).toBeGreaterThanOrEqual(2);
  });

  test('keeps gap even at hard 100/100 boundary', () => {
    const mode = normalizeTrustMode({
      silentMin: 100,
      modalMax: 100,
    });
    expect(mode.silentMin).toBe(100);
    expect(mode.modalMax).toBeLessThan(100);
  });
});
