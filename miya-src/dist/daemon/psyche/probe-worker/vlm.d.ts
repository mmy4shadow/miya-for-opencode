import type { ProbeVlmResult } from './types';
export declare function runScreenProbeVlm(input: {
    imageBase64: string;
    question: string;
    timeoutMs: number;
}): ProbeVlmResult;
