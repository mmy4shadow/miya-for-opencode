import type { SentinelState } from './state-machine';
import type { PsycheUrgency } from './consult';
export interface BucketStats {
    alpha: number;
    beta: number;
    updatedAt: string;
}
export interface FastBrainStore {
    buckets: Record<string, BucketStats>;
}
export declare const DEFAULT_FAST_BRAIN: FastBrainStore;
export declare const MAX_BUCKETS = 1200;
export declare function fastBrainBucket(input: {
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
}): string;
export declare function readFastBrainScore(fastBrainPath: string, input: {
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
}): number;
export declare function touchFastBrain(fastBrainPath: string, input: {
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    approved: boolean;
}): void;
export declare function adjustFastBrain(fastBrainPath: string, key: string, alphaDelta: number, betaDelta: number): void;
