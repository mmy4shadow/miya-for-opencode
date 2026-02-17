import { type RouteIntent } from './classifier';
export type RouteComplexity = 'low' | 'medium' | 'high';
export type RouteStage = 'low' | 'medium' | 'high';
export type RouteFixability = 'impossible' | 'rewrite' | 'reduce_scope' | 'need_evidence' | 'retry_later' | 'unknown';
export interface RouterModeConfig {
    ecoMode: boolean;
    forcedStage?: RouteStage;
    stageTokenMultiplier: Record<RouteStage, number>;
    stageCostUsdPer1k: Record<RouteStage, number>;
    contextHardCapTokens: number;
    retryDeltaMaxLines: number;
    retryBudget: {
        autoRetry: number;
        humanEdit: number;
    };
}
export interface RouteComplexitySignals {
    complexity: RouteComplexity;
    score: number;
    reasons: string[];
}
export interface RouteExecutionPlan {
    intent: RouteIntent;
    complexity: RouteComplexity;
    complexityScore: number;
    semanticConfidence: number;
    semanticAmbiguity: number;
    semanticEvidence: string[];
    stage: RouteStage;
    agent: string;
    preferredAgent: string;
    fallbackAgent: string;
    feedbackScore: number;
    feedbackSamples: number;
    ecoMode: boolean;
    reasons: string[];
    fixabilityHint: RouteFixability;
    retryBudget: {
        autoRetry: number;
        autoUsed: number;
        humanEdit: number;
        humanUsed: number;
    };
    executionMode: 'auto' | 'human_gate';
}
export interface RouterCostRecord {
    at: string;
    sessionID: string;
    intent: RouteIntent;
    complexity: RouteComplexity;
    stage: RouteStage;
    agent: string;
    success: boolean;
    inputTokens: number;
    outputTokensEstimate: number;
    totalTokensEstimate: number;
    baselineHighTokensEstimate: number;
    costUsdEstimate: number;
}
interface RouterCostSummary {
    totalRecords: number;
    totalTokensEstimate: number;
    baselineHighTokensEstimate: number;
    savingsTokensEstimate: number;
    savingsPercentEstimate: number;
    totalCostUsdEstimate: number;
    byStage: Record<RouteStage, {
        records: number;
        tokens: number;
        costUsd: number;
    }>;
}
interface RouterSessionState {
    sessionID: string;
    consecutiveFailures: number;
    lastStage: RouteStage;
    autoRetryUsed: number;
    humanEditUsed: number;
    lastFixability: RouteFixability;
    lastFailureReason?: string;
    lastContextHash?: string;
    lastContextText?: string;
    updatedAt: string;
}
export declare function readRouterModeConfig(projectDir: string): RouterModeConfig;
export declare function writeRouterModeConfig(projectDir: string, patch: Partial<RouterModeConfig>): RouterModeConfig;
export declare function analyzeRouteComplexity(text: string): RouteComplexitySignals;
export declare function buildRouteExecutionPlan(input: {
    projectDir: string;
    sessionID: string;
    text: string;
    availableAgents: string[];
    pinnedAgent?: string;
}): RouteExecutionPlan;
export declare function prepareRoutePayload(projectDir: string, input: {
    text: string;
    stage: RouteStage;
    retry?: {
        attempt?: number;
        previousContextText?: string;
        previousContextHash?: string;
        failureReason?: string;
    };
}): {
    text: string;
    compressed: boolean;
    hardCapped: boolean;
    retryDeltaApplied: boolean;
    contextHash: string;
    inputTokens: number;
    outputTokensEstimate: number;
    totalTokensEstimate: number;
    baselineHighTokensEstimate: number;
    costUsdEstimate: number;
};
export declare function recordRouteExecutionOutcome(input: {
    projectDir: string;
    sessionID: string;
    intent: RouteIntent;
    complexity: RouteComplexity;
    stage: RouteStage;
    agent: string;
    success: boolean;
    inputTokens: number;
    outputTokensEstimate: number;
    totalTokensEstimate: number;
    baselineHighTokensEstimate: number;
    costUsdEstimate: number;
    failureReason?: string;
    attemptType?: 'auto' | 'human';
    contextHash?: string;
    contextText?: string;
}): RouterCostRecord;
export declare function getRouteCostSummary(projectDir: string, limit?: number): RouterCostSummary;
export declare function listRouteCostRecords(projectDir: string, limit?: number): RouterCostRecord[];
export declare function getRouterSessionState(projectDir: string, sessionID: string): RouterSessionState;
export {};
