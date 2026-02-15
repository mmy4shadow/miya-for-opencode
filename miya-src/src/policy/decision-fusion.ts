export interface OutboundDecisionFusionInput {
  factorTextSensitive: boolean;
  factorRecipientIsMe: boolean;
  factorIntentSuspicious: boolean;
  confidenceIntent: number;
  trustMinScore?: number;
  trustMode?: {
    silentMin: number;
    modalMax: number;
  };
  evidenceConfidence?: number;
}

export interface OutboundDecisionFusionResult {
  expressionMatched: boolean;
  zone: 'safe' | 'gray' | 'danger';
  action: 'allow' | 'soft_fuse' | 'hard_fuse';
  approvalMode: 'silent_audit' | 'toast_gate' | 'modal_approval';
  reason: string;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeTrustScore(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  if ((value as number) < 0) return 0;
  if ((value as number) > 100) return 100;
  return Math.round(value as number);
}

function normalizeTrustMode(input?: {
  silentMin: number;
  modalMax: number;
}): { silentMin: number; modalMax: number } {
  let silentMin = Math.max(
    0,
    Math.min(100, Math.round(input?.silentMin ?? 90)),
  );
  let modalMax = Math.max(
    0,
    Math.min(100, Math.round(input?.modalMax ?? 50)),
  );

  if (silentMin <= modalMax) {
    const pivot = Math.round((silentMin + modalMax) / 2);
    silentMin = Math.min(100, pivot + 1);
    modalMax = Math.max(0, pivot - 1);
  }

  // Keep an integer gap so `toast_gate` remains reachable between modal/silent thresholds.
  if (silentMin - modalMax < 2) {
    if (silentMin < 100) silentMin += 1;
    else if (modalMax > 0) modalMax -= 1;
  }

  if (silentMin <= modalMax) {
    return { silentMin: 90, modalMax: 50 };
  }
  return { silentMin, modalMax };
}

function resolveApprovalMode(input: {
  action: 'allow' | 'soft_fuse' | 'hard_fuse';
  trustScore: number;
  trustMode?: {
    silentMin: number;
    modalMax: number;
  };
}): 'silent_audit' | 'toast_gate' | 'modal_approval' {
  if (input.action !== 'allow') return 'modal_approval';
  const thresholds = normalizeTrustMode(input.trustMode);
  const silentMin = thresholds.silentMin;
  const modalMax = thresholds.modalMax;
  if (input.trustScore >= silentMin) return 'silent_audit';
  if (input.trustScore <= modalMax) return 'modal_approval';
  return 'toast_gate';
}

export function evaluateOutboundDecisionFusion(
  input: OutboundDecisionFusionInput,
): OutboundDecisionFusionResult {
  const conf = normalizeConfidence(input.confidenceIntent);
  const evidenceConf = normalizeConfidence(input.evidenceConfidence ?? input.confidenceIntent);
  const trustScore = normalizeTrustScore(input.trustMinScore);
  const expressionMatched =
    (input.factorTextSensitive && !input.factorRecipientIsMe) ||
    (input.factorTextSensitive && input.factorIntentSuspicious);

  // Low-quality evidence is always escalated to at least gray zone.
  if (evidenceConf < 0.35) {
    const action: OutboundDecisionFusionResult['action'] = expressionMatched
      ? conf < 0.5
        ? 'hard_fuse'
        : 'soft_fuse'
      : 'allow';
    return {
      expressionMatched,
      zone: action === 'hard_fuse' ? 'danger' : 'gray',
      action,
      approvalMode: 'modal_approval',
      reason:
        action === 'hard_fuse'
          ? 'decision_fusion_danger_low_evidence'
          : action === 'soft_fuse'
            ? 'decision_fusion_gray_low_evidence'
            : 'decision_fusion_low_evidence_confirmation_required',
    };
  }

  if (!expressionMatched) {
    const action: OutboundDecisionFusionResult['action'] = 'allow';
    return {
      expressionMatched: false,
      zone: 'safe',
      action,
      approvalMode: resolveApprovalMode({
        action,
        trustScore,
        trustMode: input.trustMode,
      }),
      reason: 'decision_fusion_clear',
    };
  }

  if (conf < 0.5) {
    const action: OutboundDecisionFusionResult['action'] = 'hard_fuse';
    return {
      expressionMatched: true,
      zone: 'danger',
      action,
      approvalMode: 'modal_approval',
      reason: 'decision_fusion_danger',
    };
  }

  if (conf <= 0.85) {
    const action: OutboundDecisionFusionResult['action'] = 'soft_fuse';
    return {
      expressionMatched: true,
      zone: 'gray',
      action,
      approvalMode: 'modal_approval',
      reason: 'decision_fusion_gray',
    };
  }

  const action: OutboundDecisionFusionResult['action'] = 'allow';
  return {
    expressionMatched: true,
    zone: 'safe',
    action,
    approvalMode: resolveApprovalMode({
      action,
      trustScore,
      trustMode: input.trustMode,
    }),
    reason: 'decision_fusion_safe_by_confidence',
  };
}
