import type { SentinelSignals } from '../state-machine';
import { sampleAudioSignal } from './audio';
import { sampleForegroundSignal } from './foreground';
import { sampleGamepadSignal } from './gamepad';
import { sampleInputSignal } from './input';
export interface NativeSentinelSignalSample {
    sampledAt: string;
    signals: Partial<SentinelSignals>;
    captureLimitations: string[];
}
export declare function collectNativeSentinelSignals(): NativeSentinelSignalSample;
export { sampleInputSignal, sampleForegroundSignal, sampleAudioSignal, sampleGamepadSignal };
