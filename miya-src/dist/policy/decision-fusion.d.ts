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
export declare function evaluateOutboundDecisionFusion(input: OutboundDecisionFusionInput): OutboundDecisionFusionResult;
