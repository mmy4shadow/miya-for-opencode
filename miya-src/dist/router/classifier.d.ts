export type RouteIntent = 'code_fix' | 'code_search' | 'docs_research' | 'architecture' | 'ui_design' | 'general';
export interface RouteSemanticSignal {
    intent: RouteIntent;
    confidence: number;
    evidence: string[];
    scores: Record<RouteIntent, number>;
    ambiguity: number;
}
export declare function analyzeRouteSemantics(text: string): RouteSemanticSignal;
export declare function classifyIntent(text: string): RouteIntent;
export declare function recommendedAgent(intent: RouteIntent): string;
