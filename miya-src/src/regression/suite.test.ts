import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { evaluateOutboundDecisionFusion } from '../policy/decision-fusion';
import { buildRouteExecutionPlan, recordRouteExecutionOutcome } from '../router';
import { evaluateModeKernel } from '../gateway/mode-kernel';
import {
  confirmCompanionMemoryVector,
  upsertCompanionMemoryVector,
} from '../companion/memory-vector';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-regression-'));
}

const AVAILABLE = [
  '1-task-manager',
  '2-code-search',
  '3-docs-helper',
  '4-architecture-advisor',
  '5-code-fixer',
  '6-ui-designer',
];

describe('miya regression suite', () => {
  test('outbound safety triggers hard fuse on low evidence + risky intent', () => {
    const result = evaluateOutboundDecisionFusion({
      factorTextSensitive: true,
      factorRecipientIsMe: false,
      factorIntentSuspicious: true,
      confidenceIntent: 0.4,
      evidenceConfidence: 0.2,
      trustMinScore: 20,
    });
    expect(result.action).toBe('hard_fuse');
    expect(result.approvalMode).toBe('modal_approval');
  });

  test('approval fatigue escalates to human gate', () => {
    const projectDir = tempProjectDir();
    recordRouteExecutionOutcome({
      projectDir,
      sessionID: 'fatigue',
      intent: 'code_fix',
      complexity: 'low',
      stage: 'low',
      agent: '5-code-fixer',
      success: false,
      inputTokens: 120,
      outputTokensEstimate: 80,
      totalTokensEstimate: 160,
      baselineHighTokensEstimate: 220,
      costUsdEstimate: 0.002,
      failureReason: 'invalid_schema',
      attemptType: 'auto',
    });
    recordRouteExecutionOutcome({
      projectDir,
      sessionID: 'fatigue',
      intent: 'code_fix',
      complexity: 'low',
      stage: 'medium',
      agent: '5-code-fixer',
      success: false,
      inputTokens: 120,
      outputTokensEstimate: 80,
      totalTokensEstimate: 160,
      baselineHighTokensEstimate: 220,
      costUsdEstimate: 0.002,
      failureReason: 'invalid_schema',
      attemptType: 'auto',
    });
    recordRouteExecutionOutcome({
      projectDir,
      sessionID: 'fatigue',
      intent: 'code_fix',
      complexity: 'low',
      stage: 'high',
      agent: '5-code-fixer',
      success: false,
      inputTokens: 120,
      outputTokensEstimate: 80,
      totalTokensEstimate: 160,
      baselineHighTokensEstimate: 220,
      costUsdEstimate: 0.002,
      failureReason: 'invalid_schema',
      attemptType: 'auto',
    });
    const plan = buildRouteExecutionPlan({
      projectDir,
      sessionID: 'fatigue',
      text: '继续自动重试修复这个 bug',
      availableAgents: AVAILABLE,
    });
    expect(plan.executionMode).toBe('human_gate');
    expect(plan.fixabilityHint).toBe('rewrite');
  });

  test('mixed mode remains stable for dual-intent request', () => {
    const result = evaluateModeKernel({
      text: '边做边聊，先帮我修这个测试失败，再安慰我一下',
      routeComplexity: {
        complexity: 'medium',
        score: 3,
        reasons: ['contains_code_block', 'workflow_signal'],
      },
      sessionState: {
        activation: 'active',
        reply: 'auto',
        queueLength: 1,
      },
    });
    expect(result.mode).toBe('mixed');
  });

  test('memory cross-domain write requires evidence before persistent activation', () => {
    const projectDir = tempProjectDir();
    const created = upsertCompanionMemoryVector(projectDir, {
      text: '我喜欢咖啡',
      domain: 'work',
      source: 'regression',
      activate: true,
    });
    expect(created.status).toBe('pending');
    expect(() =>
      confirmCompanionMemoryVector(projectDir, {
        memoryID: created.id,
        confirm: true,
      }),
    ).toThrow('cross_domain_evidence_required');
    const activated = confirmCompanionMemoryVector(projectDir, {
      memoryID: created.id,
      confirm: true,
      evidence: ['mixed_mode=true', 'owner_ack=true'],
    });
    expect(activated?.status).toBe('active');
    expect(activated?.learningStage).toBe('persistent');
  });
});
