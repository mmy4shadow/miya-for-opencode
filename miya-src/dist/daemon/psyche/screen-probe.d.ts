import type { SentinelSignals } from './state-machine';
export interface ScreenProbeResult {
    status: 'ok' | 'black' | 'error' | 'timeout';
    method?: 'dxgi_duplication' | 'wgc_hwnd' | 'print_window';
    captureLimitations: string[];
    sceneTags: string[];
    confidence: number;
    inferredSignals: Partial<SentinelSignals>;
}
export interface ScreenProbeInput {
    intent: string;
    channel?: string;
    timeoutMs?: number;
}
export declare function runScreenProbe(input: ScreenProbeInput): ScreenProbeResult;
