import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { getMiyaRuntimeDir } from '../../workflow';
import { PsycheConsultService } from './consult';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-psyche-test-'));
}

describe('psyche consult service', () => {
  test('allows user-initiated outbound under unknown state by default', () => {
    const service = new PsycheConsultService(tempProjectDir());
    const result = service.consult({
      intent: 'outbound.send.qq',
      urgency: 'medium',
      userInitiated: true,
      channel: 'qq',
      signals: {
        foreground: 'unknown',
      },
    });
    expect(result.decision).toBe('allow');
    expect(result.state).toBe('UNKNOWN');
  });

  test('defers non-user initiated outbound when state is focus', () => {
    const service = new PsycheConsultService(tempProjectDir(), {
      shadowModeDays: 0,
    });
    const result = service.consult({
      intent: 'outbound.send.wechat',
      urgency: 'low',
      userInitiated: false,
      channel: 'wechat',
      signals: {
        idleSec: 20,
        foreground: 'ide',
      },
    });
    expect(result.state).toBe('FOCUS');
    expect(result.decision).toBe('defer');
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  test('holds non-user initiated action when screen probe is required', () => {
    const service = new PsycheConsultService(tempProjectDir(), {
      epsilon: 0,
      shadowModeDays: 0,
    });
    const result = service.consult({
      intent: 'outbound.send.wechat',
      urgency: 'medium',
      userInitiated: false,
      channel: 'wechat',
      signals: {
        idleSec: 140,
        foreground: 'browser',
        fullscreen: false,
        audioActive: true,
        screenProbe: 'not_run',
      },
    });
    expect(result.shouldProbeScreen).toBe(true);
    expect(result.decision).toBe('defer');
    expect(result.fixability).toBe('need_evidence');
    expect(result.budget.autoRetry).toBe(1);
    expect(result.budget.humanEdit).toBe(1);
  });

  test('enforces interruption budget for non-user initiated focus', () => {
    const service = new PsycheConsultService(tempProjectDir(), {
      epsilon: 0,
      shadowModeDays: 0,
    });
    const first = service.consult({
      intent: 'daily.checkin',
      urgency: 'critical',
      userInitiated: false,
      channel: 'qq',
      signals: {
        idleSec: 20,
        foreground: 'ide',
      },
    });
    const second = service.consult({
      intent: 'daily.checkin',
      urgency: 'critical',
      userInitiated: false,
      channel: 'qq',
      signals: {
        idleSec: 22,
        foreground: 'ide',
      },
    });
    expect(first.decision).toBe('allow');
    expect(second.decision).toBe('defer');
    expect(second.reason).toContain('budget_exhausted:FOCUS');
  });

  test('supports epsilon exploration for non-user initiated defer path', () => {
    const service = new PsycheConsultService(tempProjectDir(), {
      epsilon: 0.1,
      shadowModeDays: 0,
      random: { next: () => 0 },
    });
    const result = service.consult({
      intent: 'outbound.send.wechat',
      urgency: 'low',
      userInitiated: false,
      channel: 'wechat',
      signals: {
        idleSec: 30,
        foreground: 'ide',
      },
    });
    expect(result.decision).toBe('allow');
    expect(result.reason).toContain('epsilon_exploration');
  });

  test('returns fixability and zero budget for low-trust deny', () => {
    const service = new PsycheConsultService(tempProjectDir(), {
      epsilon: 0,
      shadowModeDays: 0,
    });
    service.registerOutcome({
      consultAuditID: 'seed-low-trust',
      intent: 'outbound.send.wechat',
      urgency: 'medium',
      channel: 'wechat',
      userInitiated: false,
      state: 'UNKNOWN',
      delivered: false,
      blockedReason: 'outbound_blocked:incident',
      trust: {
        target: 'wechat:risky-target',
        highRiskRollback: true,
      },
    });
    const result = service.consult({
      intent: 'outbound.send.wechat',
      urgency: 'medium',
      userInitiated: false,
      channel: 'wechat',
      trust: {
        target: 'wechat:risky-target',
      },
      signals: {
        idleSec: 30,
        foreground: 'browser',
      },
    });
    expect(result.decision).toBe('deny');
    expect(result.fixability).toBe('impossible');
    expect(result.budget.autoRetry).toBe(0);
    expect(result.budget.humanEdit).toBe(0);
    expect(result.approvalMode).toBe('modal_approval');
    expect(result.insightText.length).toBeGreaterThan(10);
  });

  test('records delayed reward outcome and appends training data', () => {
    const projectDir = tempProjectDir();
    const service = new PsycheConsultService(projectDir, {
      epsilon: 0,
      shadowModeDays: 0,
    });
    const consult = service.consult({
      intent: 'outbound.send.wechat',
      urgency: 'medium',
      userInitiated: false,
      channel: 'wechat',
      signals: {
        idleSec: 60,
        foreground: 'browser',
      },
    });
    const outcome = service.registerOutcome({
      consultAuditID: consult.auditID,
      intent: consult.intent,
      urgency: consult.urgency,
      channel: consult.channel,
      userInitiated: consult.userInitiated,
      state: consult.state,
      delivered: false,
      blockedReason: 'outbound_blocked:psyche_deferred',
    });
    expect(outcome.reward).toBe('positive');
    const psycheDir = path.join(
      getMiyaRuntimeDir(projectDir),
      'daemon',
      'psyche',
    );
    const trainingDataPath = path.join(psycheDir, 'training-data.jsonl');
    expect(fs.existsSync(trainingDataPath)).toBe(true);
    const rows = fs
      .readFileSync(trainingDataPath, 'utf-8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { type?: string });
    expect(rows.some((row) => row.type === 'observation')).toBe(true);
    expect(rows.some((row) => row.type === 'action_outcome')).toBe(true);
  });

  test('rate limits probe execution but keeps safe-hold defer', () => {
    const prevCapacity = process.env.MIYA_PSYCHE_PROBE_BUCKET_CAPACITY;
    const prevWindow = process.env.MIYA_PSYCHE_PROBE_BUCKET_WINDOW_SEC;
    process.env.MIYA_PSYCHE_PROBE_BUCKET_CAPACITY = '1';
    process.env.MIYA_PSYCHE_PROBE_BUCKET_WINDOW_SEC = '3600';
    try {
      const service = new PsycheConsultService(tempProjectDir(), {
        epsilon: 0,
        shadowModeDays: 0,
      });
      const first = service.consult({
        intent: 'outbound.send.wechat',
        urgency: 'medium',
        userInitiated: false,
        channel: 'wechat',
        signals: {
          idleSec: 160,
          foreground: 'browser',
          audioActive: true,
        },
      });
      const second = service.consult({
        intent: 'outbound.send.wechat',
        urgency: 'medium',
        userInitiated: false,
        channel: 'wechat',
        signals: {
          idleSec: 170,
          foreground: 'browser',
          audioActive: true,
        },
      });
      expect(first.shouldProbeScreen).toBe(true);
      expect(second.shouldProbeScreen).toBe(false);
      expect(first.decision).toBe('defer');
      expect(second.decision).toBe('defer');
      expect(second.reasons).toContain('probe_rate_limited');
    } finally {
      if (prevCapacity === undefined)
        delete process.env.MIYA_PSYCHE_PROBE_BUCKET_CAPACITY;
      else process.env.MIYA_PSYCHE_PROBE_BUCKET_CAPACITY = prevCapacity;
      if (prevWindow === undefined)
        delete process.env.MIYA_PSYCHE_PROBE_BUCKET_WINDOW_SEC;
      else process.env.MIYA_PSYCHE_PROBE_BUCKET_WINDOW_SEC = prevWindow;
    }
  });

  test('defaults to shadow mode safe hold for cold start non-user actions', () => {
    const service = new PsycheConsultService(tempProjectDir(), { epsilon: 0 });
    const result = service.consult({
      intent: 'outbound.send.wechat',
      urgency: 'medium',
      userInitiated: false,
      channel: 'wechat',
      signals: {
        idleSec: 20,
        foreground: 'browser',
      },
    });
    expect(result.decision).toBe('defer');
    expect(result.reasons).toContain('shadow_mode_safe_hold');
  });

  test('surfaces risk summary when probe is blocked by protected capture limits', () => {
    const service = new PsycheConsultService(tempProjectDir(), {
      epsilon: 0,
      shadowModeDays: 0,
    });
    const result = service.consult({
      intent: 'outbound.send.wechat',
      urgency: 'medium',
      userInitiated: false,
      channel: 'wechat',
      captureLimitations: ['drm_protected'],
      signals: {
        idleSec: 140,
        foreground: 'browser',
        fullscreen: true,
        audioActive: true,
        screenProbe: 'black',
      },
    });
    expect(result.state).toBe('UNKNOWN');
    expect(result.risk.drmCaptureBlocked).toBe(true);
    expect(result.risk.falseIdleUncertain).toBe(true);
  });
});
