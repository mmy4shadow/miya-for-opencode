import type { AutopilotCommandResult, AutopilotPlan, AutopilotRunInput, PlanBundleAuditEvent, PlanBundleV1 } from './types';
export declare function appendPlanBundleAudit(bundle: PlanBundleV1, input: {
    stage: PlanBundleAuditEvent['stage'];
    action: string;
    inputSummary: unknown;
    approvalBasis?: string;
    result?: unknown;
}): PlanBundleAuditEvent;
export declare function createPlanBundleV1(input: {
    goal: string;
    plan: AutopilotPlan;
    runInput: AutopilotRunInput;
}): PlanBundleV1;
export declare function markPlanBundleApproved(bundle: PlanBundleV1, input: {
    approver: string;
    reason?: string;
    policyHash?: string;
}): void;
export declare function markPlanBundleRunning(bundle: PlanBundleV1): void;
export declare function markPlanBundleExecution(bundle: PlanBundleV1, result: AutopilotCommandResult): void;
export declare function markPlanBundleVerification(bundle: PlanBundleV1, verification: AutopilotCommandResult): void;
export declare function markPlanBundleRollback(bundle: PlanBundleV1, result: AutopilotCommandResult | undefined, reason: string): void;
export declare function markPlanBundleFinalized(bundle: PlanBundleV1, input: {
    success: boolean;
    summary: string;
}): void;
