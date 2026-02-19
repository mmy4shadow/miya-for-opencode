import type { InteractionStatsSnapshot } from './interaction-stats';
import type { PsycheRiskSummary, PsycheUrgency } from '../consult';
import type { SentinelSignals, SentinelState } from '../state-machine';
import type { TrustTier } from '../trust';
export interface ProactivityContextInput {
    atMs: number;
    state: SentinelState;
    urgency: PsycheUrgency;
    userInitiated: boolean;
    fastBrainScore: number;
    resonanceScore: number;
    trustMinScore: number;
    trustTier: TrustTier;
    risk: PsycheRiskSummary;
    signals?: SentinelSignals;
    interaction: InteractionStatsSnapshot;
}
export interface ProactivityContextVector {
    vector: number[];
    featureMap: Record<string, number>;
}
export declare function buildProactivityContextVector(input: ProactivityContextInput): ProactivityContextVector;
