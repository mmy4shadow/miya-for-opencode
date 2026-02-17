export type TrustEntityKind = 'target' | 'source' | 'action';
export type TrustTier = 'high' | 'medium' | 'low';
export interface TrustEntityScore {
    score: number;
    approvedCount10: number;
    deniedCount10: number;
    usefulCount10: number;
    uselessCount10: number;
    lastDecisionAt: string;
    autoBlacklisted: boolean;
}
export interface TrustStore {
    entities: Record<string, TrustEntityScore>;
}
export interface TrustUpdateInput {
    kind: TrustEntityKind;
    value: string;
    approved: boolean;
    confidence?: number;
    highRiskRollback?: boolean;
}
export declare function getTrustScore(filePath: string, input: {
    kind: TrustEntityKind;
    value?: string;
}): number;
export declare function updateTrustScore(filePath: string, input: TrustUpdateInput): TrustEntityScore;
export declare function trustTierFromScore(score: number): TrustTier;
