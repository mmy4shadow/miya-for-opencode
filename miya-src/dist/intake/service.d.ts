import type { IntakeEvaluationEvent, IntakeListEntry, IntakeProposal, IntakeScope, IntakeState, IntakeTrigger } from './types';
export interface IntakeSourceInput {
    domain?: string;
    path?: string;
    selector?: string;
    contentHash?: string;
    sourceKey?: string;
    url?: string;
}
export interface ProposeIntakeInput {
    trigger: IntakeTrigger;
    source: IntakeSourceInput;
    summaryPoints?: string[];
    originalPlan?: string;
    suggestedChange?: string;
    benefits?: string[];
    risks?: string[];
    evidence?: string[];
    proposedChanges?: unknown;
}
export interface DecideIntakeInput {
    proposalId: string;
    decision: 'approve' | 'approve_whitelist' | 'reject' | 'reject_blacklist' | 'reject_block_scope' | 'trial_once';
    scope?: IntakeScope;
    reason?: string;
}
interface EvaluateInput {
    sourceUnitKey: string;
}
export interface IntakeStatsResult {
    sourceUnitKey: string;
    windowSize: number;
    usefulCount: number;
    rejectedCount: number;
    trialCount: number;
    consideredEvents: number;
    verdict: 'insufficient_data' | 'hard_deny' | 'downrank' | 'normal';
    recommendedExplorePercent: number;
}
export declare function listIntakeData(projectDir: string): IntakeState;
export declare function proposeIntake(projectDir: string, input: ProposeIntakeInput): {
    status: 'disabled' | 'auto_allowed' | 'auto_rejected' | 'pending';
    proposal?: IntakeProposal;
    matchedRule?: IntakeListEntry;
    stats?: IntakeStatsResult;
};
export declare function decideIntake(projectDir: string, input: DecideIntakeInput): {
    ok: boolean;
    message: string;
    proposal?: IntakeProposal;
    stats?: IntakeStatsResult;
    createdRule?: IntakeListEntry;
};
export declare function intakeStats(projectDir: string, input: EvaluateInput): IntakeStatsResult;
export declare function resolveSourceUnitKey(projectDir: string, source: IntakeSourceInput): string;
export declare function intakeSummary(projectDir: string): {
    pending: number;
    whitelist: number;
    blacklist: number;
    recentEvents: IntakeEvaluationEvent[];
    pendingItems: IntakeProposal[];
};
export {};
