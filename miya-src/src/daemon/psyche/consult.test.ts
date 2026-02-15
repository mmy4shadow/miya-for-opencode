import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
    const service = new PsycheConsultService(tempProjectDir());
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
    const service = new PsycheConsultService(tempProjectDir(), { epsilon: 0 });
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
  });

  test('enforces interruption budget for non-user initiated focus', () => {
    const service = new PsycheConsultService(tempProjectDir(), { epsilon: 0 });
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
});
