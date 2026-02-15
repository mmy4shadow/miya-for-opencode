import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildRouteExecutionPlan,
  getRouteCostSummary,
  prepareRoutePayload,
  readRouterModeConfig,
  recordRouteExecutionOutcome,
  writeRouterModeConfig,
} from './runtime';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-router-runtime-'));
}

const AVAILABLE = [
  '1-task-manager',
  '2-code-search',
  '3-docs-helper',
  '4-architecture-advisor',
  '5-code-fixer',
  '6-ui-designer',
];

describe('router runtime planning', () => {
  test('eco mode downshifts stage for medium complexity requests', () => {
    const projectDir = tempProjectDir();
    const plan = buildRouteExecutionPlan({
      projectDir,
      sessionID: 'main',
      text: '请并行执行并验证这个修复计划，包含架构风险评估。```ts\nconst x = 1;\n```',
      availableAgents: AVAILABLE,
    });
    expect(plan.complexity).toBe('high');
    expect(plan.stage).toBe('medium');
    expect(plan.reasons.includes('eco_mode_downshift')).toBe(true);
  });

  test('failure escalation upgrades stage', () => {
    const projectDir = tempProjectDir();
    recordRouteExecutionOutcome({
      projectDir,
      sessionID: 's1',
      intent: 'code_fix',
      complexity: 'low',
      stage: 'low',
      agent: '5-code-fixer',
      success: false,
      inputTokens: 100,
      outputTokensEstimate: 60,
      totalTokensEstimate: 120,
      baselineHighTokensEstimate: 180,
      costUsdEstimate: 0.001,
      failureReason: 'request_timeout',
    });
    recordRouteExecutionOutcome({
      projectDir,
      sessionID: 's1',
      intent: 'code_fix',
      complexity: 'low',
      stage: 'medium',
      agent: '5-code-fixer',
      success: false,
      inputTokens: 100,
      outputTokensEstimate: 80,
      totalTokensEstimate: 160,
      baselineHighTokensEstimate: 200,
      costUsdEstimate: 0.002,
      failureReason: 'request_timeout',
    });
    const plan = buildRouteExecutionPlan({
      projectDir,
      sessionID: 's1',
      text: '修复这个 bug',
      availableAgents: AVAILABLE,
    });
    expect(plan.stage).toBe('high');
    expect(plan.reasons.some((item) => item.startsWith('failure_escalation'))).toBe(true);
  });

  test('routes to human gate when fixability is impossible', () => {
    const projectDir = tempProjectDir();
    recordRouteExecutionOutcome({
      projectDir,
      sessionID: 's2',
      intent: 'code_fix',
      complexity: 'low',
      stage: 'low',
      agent: '5-code-fixer',
      success: false,
      inputTokens: 100,
      outputTokensEstimate: 60,
      totalTokensEstimate: 120,
      baselineHighTokensEstimate: 180,
      costUsdEstimate: 0.001,
      failureReason: 'permission_denied:forbidden',
    });
    const plan = buildRouteExecutionPlan({
      projectDir,
      sessionID: 's2',
      text: '继续执行这次修复',
      availableAgents: AVAILABLE,
    });
    expect(plan.executionMode).toBe('human_gate');
    expect(plan.fixabilityHint).toBe('impossible');
  });

  test('payload compression and cost summary work', () => {
    const projectDir = tempProjectDir();
    writeRouterModeConfig(projectDir, {
      ecoMode: true,
    });
    const current = readRouterModeConfig(projectDir);
    expect(current.ecoMode).toBe(true);

    const longText = `${'x'.repeat(5000)}\n- step1\n- step2\n- step3`;
    const payload = prepareRoutePayload(projectDir, {
      text: longText,
      stage: 'low',
    });
    expect(payload.compressed).toBe(true);
    expect(payload.totalTokensEstimate).toBeGreaterThan(0);
    expect(payload.baselineHighTokensEstimate).toBeGreaterThan(payload.totalTokensEstimate);

    recordRouteExecutionOutcome({
      projectDir,
      sessionID: 'main',
      intent: 'general',
      complexity: 'medium',
      stage: 'low',
      agent: '1-task-manager',
      success: true,
      inputTokens: payload.inputTokens,
      outputTokensEstimate: payload.outputTokensEstimate,
      totalTokensEstimate: payload.totalTokensEstimate,
      baselineHighTokensEstimate: payload.baselineHighTokensEstimate,
      costUsdEstimate: payload.costUsdEstimate,
    });
    const summary = getRouteCostSummary(projectDir, 30);
    expect(summary.totalRecords).toBe(1);
    expect(summary.savingsPercentEstimate).toBeGreaterThan(0);
  });
});
