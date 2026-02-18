import { describe, expect, test } from 'bun:test';
import {
  applyModeSafeWorkFallback,
  buildMemoryDomainPlan,
  formatMemoryEvidenceMeta,
  shouldInjectPersonaWorldPrompt,
} from './pipeline';

describe('context pipeline', () => {
  test('applies low-confidence fallback to work mode', () => {
    const result = applyModeSafeWorkFallback(
      {
        mode: 'chat',
        confidence: 0.42,
        why: ['sanitizer=chat'],
        scores: { work: 0.4, chat: 0.7, mixed: 0.2 },
      },
      0.5,
    );
    expect(result.lowConfidenceSafeFallback).toBe(true);
    expect(result.modeKernel.mode).toBe('work');
    expect(result.modeKernel.why).toContain(
      'low_confidence_safe_work_fallback',
    );
  });

  test('shares memory domain plan by mode', () => {
    expect(buildMemoryDomainPlan('work')).toEqual([
      { domain: 'work', limit: 3, threshold: 0.22 },
    ]);
    expect(buildMemoryDomainPlan('chat')).toEqual([
      { domain: 'relationship', limit: 6, threshold: 0.16 },
    ]);
    expect(buildMemoryDomainPlan('mixed')).toEqual([
      { domain: 'work', limit: 2, threshold: 0.22 },
      { domain: 'relationship', limit: 4, threshold: 0.16 },
    ]);
  });

  test('suppresses persona world prompt on work execution track', () => {
    expect(
      shouldInjectPersonaWorldPrompt({
        mode: 'work',
        executeWork: true,
      }),
    ).toBe(false);
    expect(
      shouldInjectPersonaWorldPrompt({
        mode: 'chat',
        executeWork: false,
      }),
    ).toBe(true);
  });

  test('formats memory evidence with source trace fields', () => {
    const meta = formatMemoryEvidenceMeta({
      score: 0.88,
      confidence: 0.93,
      source: 'reflect',
      sourceMessageID: 'msg_001',
      sourceType: 'reflect',
      memoryID: 'mem_001',
    });
    expect(meta).toContain('source_message_id=msg_001');
    expect(meta).toContain('source_type=reflect');
    expect(meta).toContain('memory_id=mem_001');
  });
});
