import { createHash, createHmac, randomUUID } from 'node:crypto';
import type {
  AutopilotCommandResult,
  AutopilotPlan,
  AutopilotRunInput,
  PlanBundleAuditEvent,
  PlanBundleV1,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function replayToken(bundleID: string, eventID: string, action: string): string {
  const secret =
    process.env.MIYA_PLANBUNDLE_REPLAY_SECRET?.trim() || `miya-planbundle-v1:${bundleID}`;
  return createHmac('sha256', secret).update(`${bundleID}:${eventID}:${action}`).digest('hex');
}

function summarize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value).slice(0, 320);
  } catch {
    return String(value).slice(0, 320);
  }
}

export function appendPlanBundleAudit(
  bundle: PlanBundleV1,
  input: {
    stage: PlanBundleAuditEvent['stage'];
    action: string;
    inputSummary: unknown;
    approvalBasis?: string;
    result?: unknown;
  },
): PlanBundleAuditEvent {
  const id = `pbe_${randomUUID()}`;
  const summaryText = summarize(input.inputSummary);
  const resultText = summarize(input.result);
  const event: PlanBundleAuditEvent = {
    id,
    at: nowIso(),
    stage: input.stage,
    action: input.action,
    inputSummary: summaryText,
    inputHash: digest(summaryText),
    approvalBasis: input.approvalBasis?.trim() || 'none',
    resultHash: digest(resultText),
    replayToken: replayToken(bundle.id, id, input.action),
  };
  bundle.audit.push(event);
  bundle.updatedAt = event.at;
  return event;
}

export function createPlanBundleV1(input: {
  goal: string;
  plan: AutopilotPlan;
  runInput: AutopilotRunInput;
}): PlanBundleV1 {
  const createdAt = nowIso();
  const approvalRequired = input.runInput.approval?.required === true;
  const autoApprove = input.runInput.approval?.autoApprove === true;
  const status: PlanBundleV1['status'] =
    approvalRequired && !autoApprove ? 'pending_approval' : approvalRequired ? 'approved' : 'draft';
  const bundle: PlanBundleV1 = {
    id: `pb_${randomUUID()}`,
    version: '1.0',
    goal: input.goal.trim(),
    createdAt,
    updatedAt: createdAt,
    status,
    plan: input.plan,
    approval: {
      required: approvalRequired,
      approved: !approvalRequired || autoApprove,
      approver: autoApprove ? input.runInput.approval?.approver || 'auto' : undefined,
      reason: input.runInput.approval?.reason,
      policyHash: input.runInput.approval?.policyHash,
      requestedAt: approvalRequired ? createdAt : undefined,
      approvedAt: autoApprove ? createdAt : undefined,
    },
    execution: [],
    verification: undefined,
    rollback: {
      command: input.runInput.rollbackCommand?.trim() || undefined,
      attempted: false,
    },
    audit: [],
  };
  appendPlanBundleAudit(bundle, {
    stage: 'plan',
    action: 'plan_created',
    inputSummary: {
      goal: bundle.goal,
      stepCount: bundle.plan.steps.length,
      commandCount: input.runInput.commands.length,
    },
    approvalBasis: approvalRequired ? 'approval_required' : 'approval_not_required',
    result: { status: bundle.status },
  });
  if (approvalRequired && autoApprove) {
    appendPlanBundleAudit(bundle, {
      stage: 'approval',
      action: 'approval_auto_granted',
      inputSummary: {
        approver: bundle.approval.approver,
        reason: bundle.approval.reason,
        policyHash: bundle.approval.policyHash,
      },
      approvalBasis: 'auto_approve',
      result: { approved: true },
    });
  }
  return bundle;
}

export function markPlanBundleApproved(
  bundle: PlanBundleV1,
  input: { approver: string; reason?: string; policyHash?: string },
): void {
  const approvedAt = nowIso();
  bundle.approval.required = true;
  bundle.approval.approved = true;
  bundle.approval.approver = input.approver;
  bundle.approval.reason = input.reason;
  bundle.approval.policyHash = input.policyHash;
  bundle.approval.approvedAt = approvedAt;
  bundle.status = 'approved';
  bundle.updatedAt = approvedAt;
  appendPlanBundleAudit(bundle, {
    stage: 'approval',
    action: 'approval_granted',
    inputSummary: {
      approver: input.approver,
      reason: input.reason,
      policyHash: input.policyHash,
    },
    approvalBasis: 'manual_approval',
    result: { approved: true },
  });
}

export function markPlanBundleRunning(bundle: PlanBundleV1): void {
  bundle.status = 'running';
  bundle.updatedAt = nowIso();
  appendPlanBundleAudit(bundle, {
    stage: 'execution',
    action: 'execution_started',
    inputSummary: {
      commands: bundle.plan.steps.filter((step) => step.kind === 'execution').length,
    },
    approvalBasis: bundle.approval.approved ? 'approved' : 'not_required',
    result: { status: bundle.status },
  });
}

export function markPlanBundleExecution(
  bundle: PlanBundleV1,
  result: AutopilotCommandResult,
): void {
  bundle.execution.push(result);
  bundle.updatedAt = nowIso();
  appendPlanBundleAudit(bundle, {
    stage: 'execution',
    action: 'command_executed',
    inputSummary: {
      command: result.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    },
    approvalBasis: bundle.approval.approved ? 'approved' : 'not_required',
    result: {
      ok: result.ok,
      stdoutHash: digest(result.stdout),
      stderrHash: digest(result.stderr),
    },
  });
}

export function markPlanBundleVerification(
  bundle: PlanBundleV1,
  verification: AutopilotCommandResult,
): void {
  bundle.verification = verification;
  bundle.updatedAt = nowIso();
  appendPlanBundleAudit(bundle, {
    stage: 'execution',
    action: 'verification_executed',
    inputSummary: {
      command: verification.command,
      exitCode: verification.exitCode,
      durationMs: verification.durationMs,
    },
    approvalBasis: bundle.approval.approved ? 'approved' : 'not_required',
    result: {
      ok: verification.ok,
      stdoutHash: digest(verification.stdout),
      stderrHash: digest(verification.stderr),
    },
  });
}

export function markPlanBundleRollback(
  bundle: PlanBundleV1,
  result: AutopilotCommandResult | undefined,
  reason: string,
): void {
  bundle.rollback = {
    ...bundle.rollback,
    attempted: Boolean(result || bundle.rollback.command),
    ok: result?.ok,
    exitCode: result?.exitCode,
    result,
    reason,
  };
  bundle.status = result?.ok ? 'rolled_back' : 'failed';
  bundle.updatedAt = nowIso();
  appendPlanBundleAudit(bundle, {
    stage: 'rollback',
    action: 'rollback_executed',
    inputSummary: {
      command: bundle.rollback.command,
      reason,
    },
    approvalBasis: bundle.approval.approved ? 'approved' : 'not_required',
    result: result
      ? {
          ok: result.ok,
          exitCode: result.exitCode,
          stdoutHash: digest(result.stdout),
          stderrHash: digest(result.stderr),
        }
      : { ok: false, skipped: true },
  });
}

export function markPlanBundleFinalized(
  bundle: PlanBundleV1,
  input: { success: boolean; summary: string },
): void {
  bundle.status = input.success ? 'completed' : bundle.status === 'rolled_back' ? 'rolled_back' : 'failed';
  bundle.updatedAt = nowIso();
  appendPlanBundleAudit(bundle, {
    stage: 'finalize',
    action: 'run_finalized',
    inputSummary: {
      success: input.success,
      summary: input.summary,
    },
    approvalBasis: bundle.approval.approved ? 'approved' : 'not_required',
    result: { status: bundle.status },
  });
}
