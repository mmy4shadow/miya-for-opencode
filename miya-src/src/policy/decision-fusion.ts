export interface OutboundDecisionFusionInput {
  factorTextSensitive: boolean;
  factorRecipientIsMe: boolean;
  factorIntentSuspicious: boolean;
  confidenceIntent: number;
}

export interface OutboundDecisionFusionResult {
  expressionMatched: boolean;
  zone: 'safe' | 'gray' | 'danger';
  action: 'allow' | 'soft_fuse' | 'hard_fuse';
  reason: string;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function evaluateOutboundDecisionFusion(
  input: OutboundDecisionFusionInput,
): OutboundDecisionFusionResult {
  const conf = normalizeConfidence(input.confidenceIntent);
  const expressionMatched =
    (input.factorTextSensitive && !input.factorRecipientIsMe) ||
    (input.factorTextSensitive && input.factorIntentSuspicious);

  if (!expressionMatched) {
    return {
      expressionMatched: false,
      zone: 'safe',
      action: 'allow',
      reason: 'decision_fusion_clear',
    };
  }

  if (conf < 0.5) {
    return {
      expressionMatched: true,
      zone: 'danger',
      action: 'hard_fuse',
      reason: 'decision_fusion_danger',
    };
  }

  if (conf <= 0.85) {
    return {
      expressionMatched: true,
      zone: 'gray',
      action: 'soft_fuse',
      reason: 'decision_fusion_gray',
    };
  }

  return {
    expressionMatched: true,
    zone: 'safe',
    action: 'allow',
    reason: 'decision_fusion_safe_by_confidence',
  };
}
