import type { ResourceTaskKind } from '../resource-scheduler';
export interface AudioFillerCue {
    cueID: string;
    kind: ResourceTaskKind;
    text: string;
    clipPath?: string;
    source: 'asset' | 'fallback';
    expectedLatencyMs: number;
    createdAt: string;
}
export interface AudioFillerDecision {
    shouldFill: boolean;
    expectedLatencyMs: number;
    cue?: AudioFillerCue;
}
export declare class AudioFillerController {
    private readonly projectDir;
    private readonly random;
    private readonly recentCueTexts;
    constructor(projectDir: string, options?: {
        random?: () => number;
    });
    private pickAdaptiveCue;
    decide(input: {
        kind: ResourceTaskKind;
        timeoutMs?: number;
    }): AudioFillerDecision;
}
