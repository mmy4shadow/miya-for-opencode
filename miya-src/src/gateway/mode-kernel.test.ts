import { describe, expect, test } from 'bun:test';
import { analyzeRouteComplexity } from '../router';
import { evaluateModeKernel } from './mode-kernel';

describe('mode kernel', () => {
  test('detects work mode for engineering request', () => {
    const result = evaluateModeKernel({
      text: '请修复 src/gateway/index.ts 的 TypeError 并补测试',
      routeComplexity: analyzeRouteComplexity(
        '请修复 src/gateway/index.ts 的 TypeError 并补测试',
      ),
    });
    expect(result.mode).toBe('work');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  test('detects chat mode for companionship request', () => {
    const result = evaluateModeKernel({
      text: '宝贝我今天有点焦虑，先陪我聊聊天好吗',
      routeComplexity: analyzeRouteComplexity('宝贝我今天有点焦虑，先陪我聊聊天好吗'),
    });
    expect(result.mode).toBe('chat');
  });

  test('detects mixed mode for work + emotional request', () => {
    const result = evaluateModeKernel({
      text: '边做边聊，先帮我修这个 bug，再抱抱我',
      routeComplexity: analyzeRouteComplexity('边做边聊，先帮我修这个 bug，再抱抱我'),
      sessionState: {
        activation: 'active',
        reply: 'auto',
        queueLength: 1,
      },
    });
    expect(result.mode).toBe('mixed');
    expect(result.why.length).toBeGreaterThan(0);
  });

  test('uses psyche focus signal to bias toward work', () => {
    const result = evaluateModeKernel({
      text: '给我一点建议',
      routeComplexity: analyzeRouteComplexity('给我一点建议'),
      psycheSignals: {
        foreground: 'ide',
        idleSec: 5,
        apm: 80,
      },
    });
    expect(result.mode).toBe('work');
    expect(result.why.includes('psyche=focus')).toBe(true);
  });
});

