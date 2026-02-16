import { describe, expect, test } from 'bun:test';
import {
  MODE_POLICY_FREEZE_V1,
  stripWorkAffectionatePrefix,
} from './mode-policy';

describe('mode policy freeze', () => {
  test('keeps unresolved fallback fixed to work', () => {
    expect(MODE_POLICY_FREEZE_V1.unresolvedFallbackMode).toBe('work');
    expect(MODE_POLICY_FREEZE_V1.workExecutionPersona).toBe('zero');
    expect(MODE_POLICY_FREEZE_V1.workExecutionAddressing).toBe('strip_all');
  });

  test('strips affectionate prefix from work context text', () => {
    const output = stripWorkAffectionatePrefix('亲爱的，帮我修复构建失败');
    expect(output.stripped).toBe(true);
    expect(output.text.includes('亲爱的')).toBe(false);
  });

  test('keeps non-affectionate text unchanged', () => {
    const output = stripWorkAffectionatePrefix('请修复构建失败');
    expect(output.stripped).toBe(false);
    expect(output.text).toBe('请修复构建失败');
  });
});

