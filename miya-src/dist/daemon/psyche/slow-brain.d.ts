import { type PsycheTrainingSummary } from './training-summary';
export interface SlowBrainPolicyParameters {
    consumeAllowThreshold: number;
    awayAllowThreshold: number;
    deferRetryBaseSec: number;
    confidenceBoost: number;
}
export interface SlowBrainPolicy {
    versionID: string;
    createdAt: string;
    source: {
        windowRows: number;
        outcomes: number;
    };
    metrics: {
        positiveRate: number;
        avgScore: number;
        safeHoldDefers: number;
        falseIdleRiskSignals: number;
        drmCaptureBlockedSignals: number;
    };
    parameters: SlowBrainPolicyParameters;
}
export interface SlowBrainState {
    activeVersionID?: string;
    versions: SlowBrainPolicy[];
    status: 'idle' | 'trained' | 'rolled_back' | 'skipped';
    updatedAt: string;
    lastRetrainAt?: string;
    lastRollbackAt?: string;
    lastSkipReason?: string;
}
export interface SlowBrainRetrainResult {
    ok: boolean;
    reason: 'trained' | 'skipped_insufficient_outcomes' | 'skipped_recently_trained';
    state: SlowBrainState;
    policy?: SlowBrainPolicy;
}
export interface SlowBrainRollbackResult {
    ok: boolean;
    reason: 'rolled_back' | 'rollback_target_not_found' | 'rollback_history_insufficient' | 'rollback_already_active';
    state: SlowBrainState;
}
export declare function readSlowBrainState(projectDir: string): SlowBrainState;
export declare function getActiveSlowBrainPolicy(projectDir: string): SlowBrainPolicy;
export declare function retrainSlowBrainPolicy(projectDir: string, options?: {
    force?: boolean;
    minOutcomes?: number;
    trainingWindow?: number;
    summary?: PsycheTrainingSummary;
}): SlowBrainRetrainResult;
export declare function maybeAutoRetrainSlowBrain(projectDir: string, options?: {
    minIntervalSec?: number;
    minOutcomes?: number;
    trainingWindow?: number;
}): SlowBrainRetrainResult;
export declare function rollbackSlowBrainPolicy(projectDir: string, targetVersionID?: string): SlowBrainRollbackResult;
