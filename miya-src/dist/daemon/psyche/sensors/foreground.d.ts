import type { SentinelSignals } from '../state-machine';
export declare function sampleForegroundSignal(nowMs?: number): {
    signals: Partial<SentinelSignals>;
    limitations: string[];
};
