import type { MemoryDomain } from '../companion/memory-vector';
import type { ModeKernelResult } from '../gateway/mode-kernel';
import type { GatewayMode } from '../gateway/sanitizer';

export const DEFAULT_MODE_SAFE_WORK_CONFIDENCE = 0.5;

export interface MemoryDomainPlan {
  domain: MemoryDomain;
  limit: number;
  threshold: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function applyModeSafeWorkFallback(
  modeKernel: ModeKernelResult,
  minConfidence = DEFAULT_MODE_SAFE_WORK_CONFIDENCE,
): {
  modeKernel: ModeKernelResult;
  lowConfidenceSafeFallback: boolean;
} {
  const threshold = clamp(Number(minConfidence), 0, 1);
  const lowConfidenceSafeFallback = modeKernel.confidence < threshold;
  if (!lowConfidenceSafeFallback) {
    return {
      modeKernel,
      lowConfidenceSafeFallback: false,
    };
  }
  return {
    modeKernel: {
      ...modeKernel,
      mode: 'work',
      why: modeKernel.why.includes('low_confidence_safe_work_fallback')
        ? modeKernel.why
        : [...modeKernel.why, 'low_confidence_safe_work_fallback'],
    },
    lowConfidenceSafeFallback: true,
  };
}

export function buildMemoryDomainPlan(mode: GatewayMode): MemoryDomainPlan[] {
  if (mode === 'work') {
    return [{ domain: 'work', limit: 3, threshold: 0.22 }];
  }
  if (mode === 'chat') {
    return [{ domain: 'relationship', limit: 6, threshold: 0.16 }];
  }
  return [
    { domain: 'work', limit: 2, threshold: 0.22 },
    { domain: 'relationship', limit: 4, threshold: 0.16 },
  ];
}

export function shouldInjectPersonaWorldPrompt(input: {
  mode: GatewayMode;
  executeWork: boolean;
}): boolean {
  if (input.executeWork && input.mode === 'work') return false;
  return true;
}

export function formatMemoryEvidenceMeta(input: {
  score: number;
  confidence: number;
  source: string;
  sourceMessageID?: string;
  sourceType?: string;
  memoryID?: string;
}): string {
  const source = input.source.trim() || 'manual';
  const sourceMessageID = input.sourceMessageID?.trim() || 'n/a';
  const sourceType = input.sourceType?.trim() || 'n/a';
  const memoryID = input.memoryID?.trim() || 'n/a';
  return `score=${input.score.toFixed(3)}, confidence=${input.confidence.toFixed(3)}, source=${source}, source_message_id=${sourceMessageID}, source_type=${sourceType}, memory_id=${memoryID}`;
}
