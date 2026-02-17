import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildDesktopActionPlan,
  listDesktopReplaySkills,
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

const envBackup = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!envBackup.has(name)) envBackup.set(name, process.env[name]);
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const [key, value] of envBackup.entries()) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  envBackup.clear();
});

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
    expect(first.action_plan.brains.fastBrain.active).toBe(false);
    expect(first.action_plan.brains.slowBrain.active).toBe(true);

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
    expect(second.action_plan.brains.fastBrain.active).toBe(true);
    expect(second.action_plan.brains.slowBrain.active).toBe(false);
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
        ocrBoxes: [
          {
            x: 1640,
            y: 980,
            width: 120,
            height: 52,
            text: '发送',
            confidence: 0.94,
          },
        ],
      },
    });
    expect(l2.action_plan.routeLevel).toBe('L2_OCR');
    expect(l2.action_plan.som.enabled).toBe(true);
    expect(l2.action_plan.som.selectedCandidateId).toBeDefined();
    expect(l2.action_plan.som.candidates.length).toBeGreaterThan(0);

    const l3Raw = buildDesktopActionPlan({
      projectDir,
      intent: {
        ...baseIntent,
        destination: 'Bob',
      },
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: false,
      },
    });
    expect(l3Raw.action_plan.routeLevel).toBe('L3_SOM_VLM');
    expect(l3Raw.action_plan.som.enabled).toBe(true);
    expect(l3Raw.action_plan.som.candidates.length).toBeGreaterThan(20);
  });

  test('uses L3 VLM selector in numbered candidate mode when available', () => {
    const projectDir = makeProjectDir();
    const selectorScript = path.join(projectDir, 'som-selector.cjs');
    fs.writeFileSync(
      selectorScript,
      `const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const ids = Array.isArray(payload.candidates) ? payload.candidates.map(c => Number(c.id)).filter(Number.isFinite) : [];
const candidateId = ids.length > 0 ? ids[0] : 1;
process.stdout.write(JSON.stringify({ candidateId, confidence: 0.88 }));`,
      'utf-8',
    );
    const runtimeCommand = process.execPath;
    setEnv('MIYA_DESKTOP_VLM_MAX_CALLS', '2');
    setEnv('MIYA_DESKTOP_VLM_SELECTOR_TIMEOUT_MS', '12000');
    setEnv('MIYA_QWEN3VL_CMD', `"${runtimeCommand}" "${selectorScript}"`);
    setEnv('MIYA_VISION_LOCAL_CMD', undefined);

    const plan = buildDesktopActionPlan({
      projectDir,
      intent: baseIntent,
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: false,
      },
    });
    expect(plan.action_plan.routeLevel).toBe('L3_SOM_VLM');
    expect(plan.action_plan.som.selectionSource).toBe('vlm');
    expect(plan.action_plan.som.selectedCandidateId).toBeDefined();
    expect(plan.action_plan.tokenPolicy.maxVlmCallsPerStep).toBe(2);
    expect(plan.action_plan.som.vlmCallsPlanned).toBeGreaterThanOrEqual(1);
    expect(plan.action_plan.som.vlmCallsBudget).toBeGreaterThanOrEqual(0);
    expect(plan.action_plan.som.vlmCallsBudget).toBeLessThanOrEqual(1);
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
    expect(kpi.acceptance?.checks.highRiskMisfireRate).toBe(true);
  });

  test('counts both L2 and L3 runs in SoM hit-rate KPI', () => {
    const projectDir = makeProjectDir();
    const l2 = buildDesktopActionPlan({
      projectDir,
      intent: baseIntent,
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: true,
        ocrBoxes: [
          {
            x: 1640,
            y: 980,
            width: 120,
            height: 52,
            text: '发送',
            confidence: 0.93,
          },
        ],
      },
    });
    recordDesktopActionOutcome(projectDir, {
      intent: l2.intent,
      screenState: l2.screen_state,
      actionPlan: l2,
      sent: true,
      latencyMs: 760,
      vlmCallsUsed: 0,
      somSucceeded: true,
      highRiskMisfire: false,
    });

    const l3Raw = buildDesktopActionPlan({
      projectDir,
      intent: {
        ...baseIntent,
        destination: 'Bob',
      },
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: false,
      },
    });
    const l3 = {
      ...l3Raw,
      action_plan: {
        ...l3Raw.action_plan,
        routeLevel: 'L3_SOM_VLM' as const,
        memoryHit: false,
        som: {
          ...l3Raw.action_plan.som,
          enabled: true,
          selectionSource: 'none' as const,
          selectedCandidateId: undefined,
          vlmCallsPlanned: 1,
          vlmCallsBudget: 0,
        },
      },
    };
    recordDesktopActionOutcome(projectDir, {
      intent: l3.intent,
      screenState: l3.screen_state,
      actionPlan: l3,
      sent: false,
      latencyMs: 1400,
      vlmCallsUsed: 1,
      somSucceeded: false,
      highRiskMisfire: false,
    });

    const kpi = readDesktopAutomationKpi(projectDir);
    expect(kpi.totalRuns).toBe(2);
    expect(kpi.somPathHitRate).toBe(0.5);
  });

  test('promotes successful slow-brain task to replay skill store', () => {
    const projectDir = makeProjectDir();
    const plan = buildDesktopActionPlan({
      projectDir,
      intent: {
        ...baseIntent,
        destination: 'ProjectGroup-42',
      },
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: true,
        ocrBoxes: [
          {
            x: 1624,
            y: 972,
            width: 138,
            height: 58,
            text: '发送到 ProjectGroup-42',
            confidence: 0.92,
          },
        ],
      },
    });
    expect(plan.action_plan.memoryHit).toBe(false);
    expect(plan.action_plan.brains.slowBrain.promoteReplaySkillOnSuccess).toBe(true);
    recordDesktopActionOutcome(projectDir, {
      intent: plan.intent,
      screenState: plan.screen_state,
      actionPlan: plan,
      sent: true,
      latencyMs: 980,
      vlmCallsUsed: 0,
      somSucceeded: true,
      highRiskMisfire: false,
    });
    const replaySkills = listDesktopReplaySkills(projectDir, 10);
    expect(replaySkills.length).toBeGreaterThan(0);
    expect(replaySkills[0]?.id).toBe(plan.action_plan.replaySkillId);
    expect(replaySkills[0]?.successCount).toBe(1);
  });

  test('evaluates acceptance thresholds with sample-aware checks', () => {
    const projectDir = makeProjectDir();
    setEnv('MIYA_DESKTOP_KPI_MAX_VLM_RATIO', '0.2');
    setEnv('MIYA_DESKTOP_KPI_MIN_SOM_HIT_RATE', '0.95');
    setEnv('MIYA_DESKTOP_KPI_MAX_REUSE_P95_MS', '1500');
    setEnv('MIYA_DESKTOP_KPI_MAX_HIGH_RISK_MISFIRE_RATE', '0');

    const l3 = buildDesktopActionPlan({
      projectDir,
      intent: {
        ...baseIntent,
        destination: 'KPI-L3',
      },
      screenState: {
        ...baseScreen,
        uiaAvailable: false,
        ocrAvailable: false,
      },
    });
    recordDesktopActionOutcome(projectDir, {
      intent: l3.intent,
      screenState: l3.screen_state,
      actionPlan: l3,
      sent: false,
      latencyMs: 1900,
      vlmCallsUsed: 2,
      somSucceeded: false,
      highRiskMisfire: false,
    });

    const kpi = readDesktopAutomationKpi(projectDir);
    expect(kpi.acceptance?.pass).toBe(false);
    expect(kpi.acceptance?.checks.vlmCallRatio).toBe(false);
    expect(kpi.acceptance?.checks.somPathHitRate).toBe(false);
  });
});
