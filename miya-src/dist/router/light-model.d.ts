import type { RouteIntent } from './classifier';
export interface RouteLightModelResult {
    probabilities: Record<RouteIntent, number>;
    evidence: string[];
    version: string;
}
export declare function scoreRouteIntentLightModel(text: string): RouteLightModelResult;
