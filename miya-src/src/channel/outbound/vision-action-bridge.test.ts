import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildDesktopActionPlan,
  readDesktopAutomationKpi,
  recordDesktopActionOutcome,
  type DesktopAutomationIntent,
  type DesktopScreenState,
} from './vision-action-bridge';

function makeProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-vab-test-'));
}

const baseIntent: DesktopAutomationIntent = {
  kind: 'desktop_outbound_send',
  channel: 'qq',
  appName: 'QQ',
  destination: 'Alice',
  payloadHash: 'abc123456789',
  hasText: true,
  hasMedia: false,
  risk: 'LOW',
};

const baseScreen: DesktopScreenState = {
  windowFingerprint: 'pid=1;hwnd=0x123',
  captureMethod: 'print_window',
  display: {
    width: 1920,
    height: 1080,
  },
  uiaAvailable: true,
  ocrAvailable: true,
};

describe('vision-action-bridge', () => {
  test('promotes repeated success to L0 memory replay', () => {
    const projectDir = makeProjectDir();
    const first = buildDesktopActionPlan({
      projectDir,
      intent: baseIntent,
      screenState: baseScreen,
    });
    expect(first.action_plan.routeLevel).toBe('L1_UIA');
    expect(first.action_plan.memoryHit).toBe(false);

    recordDesktopActionOutcome(projectDir, {
      intent: first.intent,
      screenState: first.screen_state,
      actionPlan: first,
      sent: true,
      latencyMs: 880,
      vlmCallsUsed: 0,
      somSucceeded: false,
    });

    const second = buildDesktopActionPlan({
      projectDir,
      intent: baseIntent,
      screenState: baseScreen,
    });
    expect(second.action_plan.routeLevel).toBe('L0_ACTION_MEMORY');
    expect(second.action_plan.memoryHit).toBe(true);
  });

  test('falls back to L2 then L3 when higher levels are unavailable', () => {
    const projectDir = makeProjectDir();
    const l2 = buildDesktopActionPlan({
      projectDir,
      intent: baseIntent,
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: true,
      },
    });
    expect(l2.action_plan.routeLevel).toBe('L2_OCR');

    const l3 = buildDesktopActionPlan({
      projectDir,
      intent: baseIntent,
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: false,
      },
    });
    expect(l3.action_plan.routeLevel).toBe('L3_SOM_VLM');
    expect(l3.action_plan.som.enabled).toBe(true);
    expect(l3.action_plan.som.candidates.length).toBeGreaterThan(20);
  });

  test('computes KPI snapshot from recorded outcomes', () => {
    const projectDir = makeProjectDir();
    const first = buildDesktopActionPlan({
      projectDir,
      intent: baseIntent,
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: false,
      },
    });
    recordDesktopActionOutcome(projectDir, {
      intent: first.intent,
      screenState: first.screen_state,
      actionPlan: first,
      sent: true,
      latencyMs: 1320,
      vlmCallsUsed: 1,
      somSucceeded: true,
      highRiskMisfire: false,
    });
    const second = buildDesktopActionPlan({
      projectDir,
      intent: {
        ...baseIntent,
        risk: 'HIGH',
      },
      screenState: baseScreen,
    });
    recordDesktopActionOutcome(projectDir, {
      intent: second.intent,
      screenState: second.screen_state,
      actionPlan: second,
      sent: true,
      latencyMs: 640,
      vlmCallsUsed: 0,
      somSucceeded: false,
      highRiskMisfire: false,
    });

    const kpi = readDesktopAutomationKpi(projectDir);
    expect(kpi.totalRuns).toBe(2);
    expect(kpi.vlmCallRatio).toBe(0.5);
    expect(kpi.somPathHitRate).toBe(1);
    expect(kpi.highRiskMisfireRate).toBe(0);
  });
});
