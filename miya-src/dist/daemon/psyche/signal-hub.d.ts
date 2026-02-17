import { type NativeSentinelSignalSample } from './sensors';
interface SignalHubCollector {
    (): NativeSentinelSignalSample;
}
export interface PsycheNativeSignalHubStatus {
    running: boolean;
    sequence: number;
    sampledAt?: string;
    ageMs: number;
    stale: boolean;
    consecutiveFailures: number;
    lastError?: string;
    sampleIntervalMs: number;
    burstIntervalMs: number;
    staleAfterMs: number;
    sample?: NativeSentinelSignalSample;
}
export declare class PsycheNativeSignalHub {
    private readonly collector;
    private readonly sampleIntervalMs;
    private readonly burstIntervalMs;
    private readonly staleAfterMs;
    private readonly burstCyclesOnChange;
    private running;
    private timer?;
    private sequence;
    private sampledAtMs;
    private consecutiveFailures;
    private burstRemaining;
    private lastError;
    private lastSample;
    constructor(options?: {
        collector?: SignalHubCollector;
        sampleIntervalMs?: number;
        burstIntervalMs?: number;
        staleAfterMs?: number;
        burstCyclesOnChange?: number;
    });
    start(): void;
    stop(): void;
    readSnapshot(): NativeSentinelSignalSample;
    getStatus(): PsycheNativeSignalHubStatus;
    private scheduleNext;
    private resolveNextDelay;
    private snapshotAgeMs;
    private sampleNow;
}
export {};
