export type IntakeTrigger =
  | 'config_change'
  | 'skill_or_toolchain_change'
  | 'high_risk_action'
  | 'directive_content'
  | 'read_only_research'
  | 'manual';

export type IntakeScope =
  | 'CONTENT_FINGERPRINT'
  | 'PAGE'
  | 'PATH_PREFIX'
  | 'DOMAIN';

export interface IntakeSource {
  domain: string;
  path: string;
  selector?: string;
  contentHash?: string;
  sourceKey?: string;
}

export interface IntakeResolution {
  decision: string;
  scope?: IntakeScope;
  reason?: string;
}

export interface IntakeProposal {
  id: string;
  status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'trial'
    | 'auto_allowed'
    | 'auto_rejected';
  trigger: IntakeTrigger;
  source: IntakeSource;
  sourceFingerprint: string;
  sourceUnitKey: string;
  summaryPoints: string[];
  originalPlan: string;
  suggestedChange: string;
  benefits: string[];
  risks: string[];
  evidence: string[];
  proposedChanges?: unknown;
  requestedAt: string;
  resolvedAt?: string;
  resolution?: IntakeResolution;
}

export interface IntakeListEntry {
  id: string;
  scope: IntakeScope;
  value: string;
  reason: string;
  createdAt: string;
}

export interface IntakeEvaluationEvent {
  id: string;
  proposalId: string;
  sourceUnitKey: string;
  sourceFingerprint: string;
  outcome: 'useful' | 'rejected' | 'trial';
  decision: string;
  timestamp: string;
}

export interface IntakeState {
  proposals: IntakeProposal[];
  whitelist: IntakeListEntry[];
  blacklist: IntakeListEntry[];
  events: IntakeEvaluationEvent[];
}
