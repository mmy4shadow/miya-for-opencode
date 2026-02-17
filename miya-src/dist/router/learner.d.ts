import type { RouteIntent } from './classifier';
interface RouteHistoryRecord {
    at: string;
    text: string;
    intent: RouteIntent;
    suggestedAgent: string;
    accepted: boolean;
    success?: boolean;
    costUsdEstimate?: number;
    riskScore?: number;
    failureReason?: string;
    stage?: 'low' | 'medium' | 'high';
}
interface RouteLearningWeights {
    accept: number;
    success: number;
    cost: number;
    risk: number;
}
export declare function readRouteLearningWeights(projectDir: string): RouteLearningWeights;
export declare function writeRouteLearningWeights(projectDir: string, patch: Partial<RouteLearningWeights>): RouteLearningWeights;
export declare function addRouteFeedback(projectDir: string, record: Omit<RouteHistoryRecord, 'at'>): RouteHistoryRecord;
export declare function summarizeRouteHistory(projectDir: string): string;
export declare function rankAgentsByFeedback(projectDir: string, intent: RouteIntent, availableAgents: string[]): Array<{
    agent: string;
    score: number;
    samples: number;
    acceptRate: number;
    successRate: number;
    avgCostUsd: number;
    avgRisk: number;
}>;
export {};
