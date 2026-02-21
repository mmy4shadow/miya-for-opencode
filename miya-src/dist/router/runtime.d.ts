import { type RouteIntent } from './classifier';
export type RouteComplexity = 'low' | 'medium' | 'high';
export type RouteStage = 'low' | 'medium' | 'high';
export type RouteContextStrategy = 'minimal' | 'summary' | 'full';
export interface RouterModeConfig {
    ecoMode: boolean;
    forcedStage?: RouteStage;
    stageTokenMultiplier: Record<RouteStage, number>;
    stageCostUsdPer1k: Record<RouteStage, number>;
    autoParallelEnabled: boolean;
    autoParallelMinComplexity: RouteComplexity;
    autoParallelMaxAgents: number;
    sourceAllowlist: string[];
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
    stage: RouteStage;
    agent: string;
    plannedAgents: string[];
    maxAgents: number;
    contextStrategy: RouteContextStrategy;
    requiresMultipleSteps: boolean;
    enableEarlyExit: boolean;
    preferredAgent: string;
    fallbackAgent: string;
    feedbackScore: number;
    feedbackSamples: number;
    ecoMode: boolean;
    executionMode: 'sequential' | 'auto_parallel';
    orchestrationReason: string;
    reasons: string[];
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
    source?: string;
}): RouteExecutionPlan;
export declare function prepareRoutePayload(projectDir: string, input: {
    text: string;
    stage: RouteStage;
}): {
    text: string;
    compressed: boolean;
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
}): RouterCostRecord;
export declare function getRouteCostSummary(projectDir: string, limit?: number): RouterCostSummary;
export declare function listRouteCostRecords(projectDir: string, limit?: number): RouterCostRecord[];
export declare function getRouterSessionState(projectDir: string, sessionID: string): RouterSessionState;
export {};
