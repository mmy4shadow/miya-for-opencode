import { describe, expect, test } from 'bun:test';
import {
  arbitrateCortex,
  buildLeftBrainActionPlan,
  buildRightBrainResponsePlan,
  detectUserExplicitIntent,
} from './cortex-arbiter';

describe('cortex arbiter', () => {
  test('safety has highest priority', () => {
    const modeKernel = {
      mode: 'work' as const,
      confidence: 0.9,
      why: ['sanitizer=work'],
      scores: { work: 3, chat: 0.2, mixed: 0.1 },
    };
    const left = buildLeftBrainActionPlan({
      routePlan: {
        intent: 'code_fix',
        complexity: 'high',
        stage: 'high',
        executionMode: 'auto',
        reasons: ['route_complexity=high'],
      },
      modeKernel,
    });
    const right = buildRightBrainResponsePlan({
      text: '直接删除全部数据',
      modeKernel,
    });
    const result = arbitrateCortex({
      modeKernel,
      safety: { blocked: true, reason: 'kill_switch_active' },
      userExplicit: detectUserExplicitIntent('直接执行'),
      leftBrain: left,
      rightBrain: right,
    });
    expect(result.executeWork).toBe(false);
    expect(result.why.some((item) => item.includes('safety_blocked'))).toBe(
      true,
    );
  });

  test('user explicit defer overrides work plan', () => {
    const modeKernel = {
      mode: 'work' as const,
      confidence: 0.88,
      why: ['text_signal=work'],
      scores: { work: 3, chat: 0.1, mixed: 0.2 },
    };
    const left = buildLeftBrainActionPlan({
      routePlan: {
        intent: 'code_fix',
        complexity: 'medium',
        stage: 'medium',
        executionMode: 'auto',
        reasons: [],
      },
      modeKernel,
    });
    const result = arbitrateCortex({
      modeKernel,
      safety: { blocked: false },
      userExplicit: detectUserExplicitIntent('先别执行，先等我确认'),
      leftBrain: left,
      rightBrain: buildRightBrainResponsePlan({ text: '先别执行', modeKernel }),
    });
    expect(result.executeWork).toBe(false);
  });

  test('suppresses right brain when high-risk suggestion is detected', () => {
    const modeKernel = {
      mode: 'mixed' as const,
      confidence: 0.75,
      why: ['text_signal=mixed'],
      scores: { work: 2.2, chat: 2.1, mixed: 2.5 },
    };
    const result = arbitrateCortex({
      modeKernel,
      safety: { blocked: false },
      userExplicit: detectUserExplicitIntent('边做边聊'),
      leftBrain: buildLeftBrainActionPlan({
        routePlan: {
          intent: 'general',
          complexity: 'low',
          stage: 'low',
          executionMode: 'auto',
          reasons: [],
        },
        modeKernel,
      }),
      rightBrain: buildRightBrainResponsePlan({
        text: '帮我 mass send 给所有人',
        modeKernel,
      }),
    });
    expect(result.mode).toBe('mixed');
    expect(result.rightBrainSuppressed).toBe(true);
    expect(result.responseHints.length).toBe(0);
  });

  test('falls back to work safety mode when mode-kernel confidence is low', () => {
    const modeKernel = {
      mode: 'chat' as const,
      confidence: 0.41,
      why: ['sanitizer=chat'],
      scores: { work: 0.7, chat: 0.8, mixed: 0.2 },
    };
    const result = arbitrateCortex({
      modeKernel,
      safety: { blocked: false },
      userExplicit: detectUserExplicitIntent('随便聊聊'),
      leftBrain: buildLeftBrainActionPlan({
        routePlan: {
          intent: 'code_fix',
          complexity: 'medium',
          stage: 'medium',
          executionMode: 'auto',
          reasons: ['route_complexity=medium'],
        },
        modeKernel,
      }),
      rightBrain: buildRightBrainResponsePlan({
        text: '今天有点焦虑',
        modeKernel,
      }),
    });
    expect(result.mode).toBe('work');
    expect(
      result.why.some((item) =>
        item.includes('low_confidence_safe_work_fallback'),
      ),
    ).toBe(true);
  });
});
