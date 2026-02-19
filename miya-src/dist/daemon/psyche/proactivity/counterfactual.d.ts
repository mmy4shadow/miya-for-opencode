import type { ProactivityContextVector } from './context-vector';
import type { PsycheDecision, PsycheUrgency } from '../consult';
import type { SentinelState } from '../state-machine';
export type ProactivityAction = 'send_now' | 'wait_5m' | 'wait_15m' | 'wait_30m' | 'skip';
export interface CounterfactualInput {
    state: SentinelState;
    urgency: PsycheUrgency;
    baseDecision: PsycheDecision;
    userInitiated: boolean;
    context: ProactivityContextVector;
}
export interface CounterfactualResult {
    action: ProactivityAction;
    waitSec: number;
    scoreNow: number;
    scoreWait: number;
    scores: Record<ProactivityAction, number>;
    reasonCodes: string[];
}
export declare function evaluateProactivityCounterfactual(input: CounterfactualInput): CounterfactualResult;
