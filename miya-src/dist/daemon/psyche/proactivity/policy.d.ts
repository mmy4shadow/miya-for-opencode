import type { ProactivityContextVector } from './context-vector';
import { type ProactivityAction } from './counterfactual';
import type { PsycheDecision, PsycheUrgency } from '../consult';
import type { SentinelState } from '../state-machine';
export interface ProactivityPolicyInput {
    at: string;
    intent: string;
    channel?: string;
    userInitiated: boolean;
    urgency: PsycheUrgency;
    state: SentinelState;
    baseDecision: PsycheDecision;
    context: ProactivityContextVector;
}
export interface ProactivityPolicyResult {
    action: ProactivityAction;
    decision: PsycheDecision;
    waitSec: number;
    scoreNow: number;
    scoreWait: number;
    reasonCodes: string[];
    scores: Record<ProactivityAction, number>;
}
export interface ProactivityDecisionLog {
    at: string;
    intent: string;
    channel?: string;
    userInitiated: boolean;
    urgency: PsycheUrgency;
    state: SentinelState;
    baseDecision: PsycheDecision;
    action: ProactivityAction;
    decision: PsycheDecision;
    waitSec: number;
    scoreNow: number;
    scoreWait: number;
    reasonCodes: string[];
}
export declare function resolveProactivityPolicy(input: ProactivityPolicyInput): ProactivityPolicyResult;
export declare function appendProactivityDecision(filePath: string, row: ProactivityDecisionLog): void;
