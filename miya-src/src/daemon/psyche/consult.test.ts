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
});
