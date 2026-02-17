import type { SentinelSignals } from '../state-machine';
export type ProbeCaptureMethod = 'dxgi_duplication' | 'wgc_hwnd' | 'print_window';
export interface ProbeCaptureResult {
    ok: boolean;
    method?: ProbeCaptureMethod;
    imageBase64?: string;
    blackFrame?: boolean;
    timedOut?: boolean;
    limitations: string[];
    error?: string;
}
export interface ProbeVlmResult {
    ok: boolean;
    sceneTags: string[];
    confidence: number;
    limitations: string[];
    inferredSignals: Partial<SentinelSignals>;
    error?: string;
}
