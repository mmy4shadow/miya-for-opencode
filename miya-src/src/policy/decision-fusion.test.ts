import { describe, expect, test } from 'bun:test';
import { evaluateOutboundDecisionFusion } from './decision-fusion';

describe('outbound decision fusion', () => {
  test('allows when expression is not matched', () => {
    const result = evaluateOutboundDecisionFusion({
      factorTextSensitive: false,
      factorRecipientIsMe: false,
      factorIntentSuspicious: true,
      confidenceIntent: 0.92,
      trustMinScore: 96,
      trustMode: {
        silentMin: 90,
        modalMax: 50,
      },
    });
    expect(result.action).toBe('allow');
    expect(result.zone).toBe('safe');
    expect(result.approvalMode).toBe('silent_audit');
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
    expect(result.approvalMode).toBe('modal_approval');
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
    expect(result.approvalMode).toBe('modal_approval');
  });

  test('downgrades to toast gate when trust is medium', () => {
    const result = evaluateOutboundDecisionFusion({
      factorTextSensitive: false,
      factorRecipientIsMe: true,
      factorIntentSuspicious: false,
      confidenceIntent: 0.96,
      trustMinScore: 70,
      trustMode: {
        silentMin: 90,
        modalMax: 50,
      },
    });
    expect(result.action).toBe('allow');
    expect(result.zone).toBe('safe');
    expect(result.approvalMode).toBe('toast_gate');
  });

  test('escalates low-evidence capture to modal flow', () => {
    const result = evaluateOutboundDecisionFusion({
      factorTextSensitive: false,
      factorRecipientIsMe: true,
      factorIntentSuspicious: false,
      confidenceIntent: 0.95,
      evidenceConfidence: 0.2,
    });
    expect(result.action).toBe('allow');
    expect(result.zone).toBe('safe');
    expect(result.reason).toBe('decision_fusion_low_evidence_confirmation_required');
    expect(result.approvalMode).toBe('modal_approval');
  });
});
