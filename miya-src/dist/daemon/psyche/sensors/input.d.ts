import type { SentinelSignals } from '../state-machine';
export declare function sampleInputSignal(nowMs?: number): {
    signals: Partial<SentinelSignals>;
    limitations: string[];
};
