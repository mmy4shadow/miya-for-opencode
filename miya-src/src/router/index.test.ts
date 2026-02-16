import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  analyzeRouteSemantics,
  addRouteFeedback,
  classifyIntent,
  rankAgentsByFeedback,
  readRouteLearningWeights,
  recommendedAgent,
  resolveAgentWithFeedback,
  resolveFallbackAgent,
  writeRouteLearningWeights,
} from './index';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-router-test-'));
}

describe('router feedback learning', () => {
  test('classifies and recommends baseline agent', () => {
    const intent = classifyIntent('这个功能有 bug 需要修复');
    expect(intent).toBe('code_fix');
    expect(recommendedAgent(intent)).toBe('5-code-fixer');
  });

  test('extracts semantic evidence for routing confidence', () => {
    const signal = analyzeRouteSemantics('请查找并修复这个 compile failing 问题，附上 docs 引用');
    expect(signal.intent).toBe('code_fix');
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.evidence.length).toBeGreaterThan(0);
    expect(signal.evidence.some((item) => item.startsWith('light_model:'))).toBe(true);
  });

  test('light model disambiguates architecture intent with workflow wording', () => {
    const signal = analyzeRouteSemantics('给我一个 plan -> exec -> verify -> fix 的统一状态图和失败预算');
    expect(signal.intent).toBe('architecture');
    expect(signal.confidence).toBeGreaterThan(0.4);
  });

  test('uses feedback ranking to override fallback selection', () => {
    const projectDir = tempProjectDir();
    addRouteFeedback(projectDir, {
      text: 'fix bug 1',
      intent: 'code_fix',
      suggestedAgent: '2-code-search',
      accepted: true,
    });
    addRouteFeedback(projectDir, {
      text: 'fix bug 2',
      intent: 'code_fix',
      suggestedAgent: '2-code-search',
      accepted: true,
    });
    addRouteFeedback(projectDir, {
      text: 'fix bug 3',
      intent: 'code_fix',
      suggestedAgent: '5-code-fixer',
      accepted: false,
    });
    const available = ['1-task-manager', '2-code-search', '5-code-fixer'];
    const ranked = rankAgentsByFeedback(projectDir, 'code_fix', available);
    const fallback = resolveFallbackAgent('code_fix', available);
    const selected = resolveAgentWithFeedback('code_fix', available, ranked);
    expect(fallback).toBe('5-code-fixer');
    expect(selected).toBe('2-code-search');
  });

  test('persists learning weights with normalization', () => {
    const projectDir = tempProjectDir();
    const next = writeRouteLearningWeights(projectDir, {
      accept: 4,
      success: 4,
      cost: 1,
      risk: 1,
    });
    const loaded = readRouteLearningWeights(projectDir);
    expect(next.accept).toBe(loaded.accept);
    expect(loaded.accept + loaded.success + loaded.cost + loaded.risk).toBeCloseTo(1, 4);
  });
});
