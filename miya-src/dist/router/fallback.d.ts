import { type RouteIntent } from './classifier';
export declare function resolveFallbackAgent(intent: RouteIntent, availableAgents: string[]): string;
export declare function resolveAgentWithFeedback(intent: RouteIntent, availableAgents: string[], ranked: Array<{
    agent: string;
    score: number;
}>): string;
