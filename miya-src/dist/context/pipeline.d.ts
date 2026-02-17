import type { MemoryDomain } from '../companion/memory-vector';
import type { ModeKernelResult } from '../gateway/mode-kernel';
import type { GatewayMode } from '../gateway/sanitizer';
export declare const DEFAULT_MODE_SAFE_WORK_CONFIDENCE = 0.5;
export interface MemoryDomainPlan {
    domain: MemoryDomain;
    limit: number;
    threshold: number;
}
export declare function applyModeSafeWorkFallback(modeKernel: ModeKernelResult, minConfidence?: number): {
    modeKernel: ModeKernelResult;
    lowConfidenceSafeFallback: boolean;
};
export declare function buildMemoryDomainPlan(mode: GatewayMode): MemoryDomainPlan[];
export declare function shouldInjectPersonaWorldPrompt(input: {
    mode: GatewayMode;
    executeWork: boolean;
}): boolean;
export declare function formatMemoryEvidenceMeta(input: {
    score: number;
    confidence: number;
    source: string;
    sourceMessageID?: string;
    sourceType?: string;
    memoryID?: string;
}): string;
