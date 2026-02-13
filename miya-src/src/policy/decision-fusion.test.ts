import { describe, expect, test } from 'bun:test';
import { evaluateOutboundDecisionFusion } from './decision-fusion';

describe('outbound decision fusion', () => {
  test('allows when expression is not matched', () => {
    const result = evaluateOutboundDecisionFusion({
      factorTextSensitive: false,
      factorRecipientIsMe: false,
      factorIntentSuspicious: true,
      confidenceIntent: 0.2,
    });
    expect(result.action).toBe('allow');
    expect(result.zone).toBe('safe');
  });

  test('soft-fuses in gray zone', () => {
    const result = evaluateOutboundDecisionFusion({
      factorTextSensitive: true,
      factorRecipientIsMe: false,
      factorIntentSuspicious: false,
      confidenceIntent: 0.7,
    });
    expect(result.action).toBe('soft_fuse');
    expect(result.zone).toBe('gray');
  });

  test('hard-fuses in danger zone', () => {
    const result = evaluateOutboundDecisionFusion({
      factorTextSensitive: true,
      factorRecipientIsMe: true,
      factorIntentSuspicious: true,
      confidenceIntent: 0.1,
    });
    expect(result.action).toBe('hard_fuse');
    expect(result.zone).toBe('danger');
  });
});
