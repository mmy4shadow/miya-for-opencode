export interface AutopilotPlanStep {
  id: string;
  title: string;
  kind: 'analysis' | 'execution' | 'verification';
  command?: string;
  done: boolean;
  note?: string;
}

export interface AutopilotPlan {
  goal: string;
  createdAt: string;
  steps: AutopilotPlanStep[];
}

export interface AutopilotCommandResult {
  command: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type PlanBundleStage =
  | 'plan'
  | 'approval'
  | 'execution'
  | 'rollback'
  | 'audit'
  | 'finalize';

export type PlanBundleMode = 'work' | 'chat' | 'mixed' | 'subagent';
export type PlanBundleRiskTier = 'LIGHT' | 'STANDARD' | 'THOROUGH';
export type PlanBundleLifecycleState =
  | 'draft'
  | 'proposed'
  | 'approved'
  | 'executing'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'postmortem';

export interface PlanBundleBudget {
  timeMs: number;
  costUsd: number;
  retries: number;
}

export interface PlanBundleCapabilities {
  needed: string[];
}

export interface PlanBundleStep {
  id: string;
  intent: string;
  tools: string[];
  expectedArtifacts: string[];
  rollback: string;
  done: boolean;
  command?: string;
}

export interface PlanBundleVerificationPlan {
  command?: string;
  checks: string[];
}

export interface PlanBundleAuditEvent {
  id: string;
  at: string;
  stage: PlanBundleStage;
  action: string;
  inputSummary: string;
  inputHash: string;
  approvalBasis: string;
  resultHash: string;
  replayToken: string;
}

export interface PlanBundleApproval {
  required: boolean;
  approved: boolean;
  approver?: string;
  reason?: string;
  policyHash?: string;
  requestedAt?: string;
  approvedAt?: string;
}

export interface PlanBundleRollback {
  command?: string;
  attempted: boolean;
  ok?: boolean;
  exitCode?: number;
  result?: AutopilotCommandResult;
  reason?: string;
}

export interface PlanBundleV1 {
  bundleId: string;
  id: string;
  version: '1.0';
  goal: string;
  mode: PlanBundleMode;
  riskTier: PlanBundleRiskTier;
  lifecycleState: PlanBundleLifecycleState;
  budget: PlanBundleBudget;
  capabilitiesNeeded: string[];
  steps: PlanBundleStep[];
  approvalPolicy: {
    required: boolean;
    mode: 'manual' | 'auto';
  };
  verificationPlan: PlanBundleVerificationPlan;
  policyHash: string;
  createdAt: string;
  updatedAt: string;
  status:
    | 'draft'
    | 'pending_approval'
    | 'approved'
    | 'running'
    | 'completed'
    | 'failed'
    | 'rolled_back';
  plan: AutopilotPlan;
  approval: PlanBundleApproval;
  execution: AutopilotCommandResult[];
  verification?: AutopilotCommandResult;
  rollback: PlanBundleRollback;
  audit: PlanBundleAuditEvent[];
}

export interface AutopilotApprovalInput {
  required?: boolean;
  autoApprove?: boolean;
  approver?: string;
  reason?: string;
  policyHash?: string;
}

export interface AutopilotRunInput {
  projectDir?: string;
  sessionID?: string;
  goal: string;
  commands: string[];
  verificationCommand?: string;
  rollbackCommand?: string;
  maxRetriesPerCommand?: number;
  approval?: AutopilotApprovalInput;
  timeoutMs: number;
  workingDirectory?: string;
  mode?: PlanBundleMode;
  riskTier?: PlanBundleRiskTier;
  capabilitiesNeeded?: string[];
  policyHash?: string;
  planBundleID?: string;
  enforceSafetyGate?: boolean;
}

export interface AutopilotRunDigest {
  at: string;
  success: boolean;
  commandCount: number;
  retryCount: number;
  verificationAttempted: boolean;
  verificationPassed: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  failureReason?: string;
}

export interface AutopilotStats {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  rollbackRuns: number;
  rollbackSuccessRuns: number;
  verificationRuns: number;
  verificationFailedRuns: number;
  totalRetries: number;
  streakSuccess: number;
  streakFailure: number;
  lastFailureReason?: string;
  updatedAt: string;
  recent: AutopilotRunDigest[];
}

export interface AutopilotRunResult {
  success: boolean;
  retryCount: number;
  summary: string;
  planBundle: PlanBundleV1;
  plan: AutopilotPlan;
  execution: AutopilotCommandResult[];
  verification?: AutopilotCommandResult;
  rollback?: AutopilotCommandResult;
  auditLedger: PlanBundleAuditEvent[];
}
