import { describe, expect, test } from 'bun:test';
import { inferContextMode, sanitizeGatewayContext } from './sanitizer';

describe('gateway sanitizer', () => {
  test('prefers work mode for code-like input', () => {
    const mode = inferContextMode('请修复 src/gateway/index.ts 的 TypeError 报错');
    expect(mode).toBe('work');
  });

  test('prefers chat mode for companion-like input', () => {
    const mode = inferContextMode('宝贝晚安，陪我聊聊天');
    expect(mode).toBe('chat');
  });

  test('removes persona words in work mode', () => {
    const out = sanitizeGatewayContext({
      text: '亲爱的，帮我修复这个函数报错',
      modeHint: 'work',
    });
    expect(out.payload).toContain('technical coding assistant');
    expect(out.payload.includes('亲爱')).toBe(false);
    expect(out.removedSignals).toContain('persona_words');
  });

  test('removes code context lines in chat mode', () => {
    const out = sanitizeGatewayContext({
      text: ['给我讲讲今天的进展', 'src/gateway/index.ts', 'at runTask (service.ts:42)'].join('\n'),
      modeHint: 'chat',
    });
    expect(out.payload).toContain('girlfriend assistant');
    expect(out.payload.includes('src/gateway/index.ts')).toBe(false);
    expect(out.removedSignals).toContain('code_context_line');
  });

  test('supports mixed mode envelope', () => {
    const out = sanitizeGatewayContext({
      text: '边做边聊：请修复报错，也陪我一下',
      modeHint: 'mixed',
    });
    expect(out.mode).toBe('mixed');
    expect(out.payload).toContain('[Context Mode: MIXED]');
  });
});
