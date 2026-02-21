import type { RouteIntent } from './classifier';
import type { RouteComplexity, RouteStage } from './runtime';
export interface RouterUsageRecord {
    at: string;
    sessionID: string;
    intent: RouteIntent;
    complexity: RouteComplexity;
    stage: RouteStage;
    agent: string;
    estimatedTokens: number;
    estimatedCostUsd: number;
    actualInputTokens: number;
    actualOutputTokens: number;
    actualTotalTokens: number;
    actualCostUsd: number;
}
export interface RouterUsageSummary {
    totalRecords: number;
    estimatedTokens: number;
    actualTokens: number;
    estimatedCostUsd: number;
    actualCostUsd: number;
    tokenDelta: number;
    tokenDeltaPercent: number;
    costDeltaUsd: number;
}
export declare function appendRouteUsageRecord(projectDir: string, input: Omit<RouterUsageRecord, 'at'> & {
    at?: string;
}): RouterUsageRecord;
export declare function listRouteUsageRecords(projectDir: string, limit?: number): RouterUsageRecord[];
export declare function summarizeRouteUsage(projectDir: string, limit?: number): RouterUsageSummary;
