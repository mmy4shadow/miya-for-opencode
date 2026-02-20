export type RouteIntent = 'code_fix' | 'code_search' | 'docs_research' | 'architecture' | 'ui_design' | 'general';
export declare function classifyIntent(text: string): RouteIntent;
export declare function recommendedAgent(intent: RouteIntent): string;
