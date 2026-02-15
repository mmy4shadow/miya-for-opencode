import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectNegativeFeedbackText,
  readModeObservability,
  recordModeObservability,
} from './mode-observability';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-mode-observe-test-'));
}

describe('mode observability', () => {
  test('tracks switch and rollback rates', () => {
    const projectDir = tempProjectDir();
    recordModeObservability(projectDir, {
      turnID: 't1',
      finalMode: 'work',
      rollback: false,
      autonomousAttempt: true,
      autonomousSuccess: true,
      negativeFeedback: false,
    });
    recordModeObservability(projectDir, {
      turnID: 't2',
      finalMode: 'chat',
      rollback: true,
      autonomousAttempt: false,
      autonomousSuccess: false,
      negativeFeedback: true,
    });
    const snapshot = readModeObservability(projectDir);
    expect(snapshot.totals.turns).toBe(2);
    expect(snapshot.totals.modeSwitches).toBe(1);
    expect(snapshot.metrics.misclassificationRollbackRate).toBeGreaterThan(0);
    expect(snapshot.metrics.userNegativeFeedbackRate).toBeGreaterThan(0);
  });

  test('detects negative feedback text', () => {
    expect(detectNegativeFeedbackText('这个不对，别这样')).toBe(true);
    expect(detectNegativeFeedbackText('谢谢你，继续就好')).toBe(false);
  });
});

