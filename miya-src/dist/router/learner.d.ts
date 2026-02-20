import type { RouteIntent } from './classifier';
interface RouteHistoryRecord {
    at: string;
    text: string;
    intent: RouteIntent;
    suggestedAgent: string;
    accepted: boolean;
}
export declare function addRouteFeedback(projectDir: string, record: Omit<RouteHistoryRecord, 'at'>): RouteHistoryRecord;
export declare function summarizeRouteHistory(projectDir: string): string;
export declare function rankAgentsByFeedback(projectDir: string, intent: RouteIntent, availableAgents: string[]): Array<{
    agent: string;
    score: number;
    samples: number;
    acceptRate: number;
}>;
export {};
