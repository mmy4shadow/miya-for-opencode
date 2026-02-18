import { type DesktopActionPlanV2 } from './action-engine';
export interface DesktopActionExecutionStep {
    id: string;
    kind: string;
    status: 'planned' | 'ok' | 'failed' | 'skipped';
    message?: string;
    durationMs?: number;
}
export interface DesktopActionExecutionResult {
    ok: boolean;
    dryRun: boolean;
    traceID: string;
    platform: 'windows' | 'other';
    startedAt: string;
    finishedAt: string;
    executedCount: number;
    plannedCount?: number;
    remainingCount?: number;
    retryCount?: number;
    retryClass?: 'none' | 'target_not_found' | 'verification_failed' | 'input_mutex' | 'unsupported_action' | 'timeout' | 'unknown';
    recoveryAdvice?: 'none' | 'recapture_screen_and_retry' | 'wait_user_idle_then_retry' | 'manual_takeover';
    nextActionHint?: 'done' | 'decide_next_step' | 'refresh_observation_then_decide' | 'wait_user_idle_then_decide' | 'manual_takeover';
    failureStepID?: string;
    failureReason?: string;
    inputMutexTriggered: boolean;
    steps: DesktopActionExecutionStep[];
    stdout?: string;
    stderr?: string;
}
interface DesktopActionExecutionInput {
    projectDir: string;
    plan: DesktopActionPlanV2;
    dryRun?: boolean;
    timeoutMs?: number;
    singleStep?: boolean;
    stepRetryLimit?: number;
    verifyAfterAction?: boolean;
}
export declare function executeDesktopActionPlan(input: DesktopActionExecutionInput): Promise<DesktopActionExecutionResult>;
export {};
