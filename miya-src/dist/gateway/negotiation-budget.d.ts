export type NegotiationFixability = 'impossible' | 'rewrite' | 'reduce_scope' | 'need_evidence' | 'retry_later';
export interface NegotiationBudget {
    autoRetry: number;
    humanEdit: number;
}
export interface NegotiationBudgetState {
    key: string;
    fixability: NegotiationFixability;
    budget: NegotiationBudget;
    autoUsed: number;
    humanUsed: number;
    updatedAt: string;
}
export interface ApplyNegotiationBudgetInput {
    key: string;
    fixability: NegotiationFixability;
    budget: NegotiationBudget;
    attemptType?: 'auto' | 'human';
}
export interface ApplyNegotiationBudgetResult {
    allowed: boolean;
    state: NegotiationBudgetState;
    reason?: 'fixability_impossible' | 'auto_retry_exhausted' | 'human_edit_exhausted';
}
export declare function applyNegotiationBudget(store: Map<string, NegotiationBudgetState>, input: ApplyNegotiationBudgetInput): ApplyNegotiationBudgetResult;
