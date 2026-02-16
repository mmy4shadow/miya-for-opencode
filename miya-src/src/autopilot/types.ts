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
  id: string;
  version: '1.0';
  goal: string;
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
  goal: string;
  commands: string[];
  verificationCommand?: string;
  rollbackCommand?: string;
  approval?: AutopilotApprovalInput;
  timeoutMs: number;
  workingDirectory?: string;
}

export interface AutopilotRunResult {
  success: boolean;
  summary: string;
  planBundle: PlanBundleV1;
  plan: AutopilotPlan;
  execution: AutopilotCommandResult[];
  verification?: AutopilotCommandResult;
  rollback?: AutopilotCommandResult;
  auditLedger: PlanBundleAuditEvent[];
}
