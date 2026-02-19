import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readModeObservability,
  recordModeObservability,
} from '../../src/gateway/mode-observability';
import { getMiyaRuntimeDir } from '../../src/workflow';

function createTempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-observe-hardening-'));
}

describe('diagnostic observability hardening', () => {
  test('normalizes corrupted persisted counters before recording next turn', () => {
    const projectDir = createTempProjectDir();
    const runtimeDir = getMiyaRuntimeDir(projectDir);
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'mode-observability.json'),
      JSON.stringify(
        {
          version: 99,
          totals: {
            turns: '9',
            modeSwitches: '-2',
            misclassificationRollbacks: 'oops',
            autonomousAttempts: 3.8,
            autonomousCompletions: 'NaN',
            negativeFeedbackTurns: null,
          },
          lastMode: 'invalid-mode',
          lastTurnID: 123,
          updatedAt: 'not-a-date',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const snapshot = recordModeObservability(projectDir, {
      turnID: 't-next',
      finalMode: 'chat',
      rollback: true,
      autonomousAttempt: true,
      autonomousSuccess: true,
      negativeFeedback: false,
    });

    expect(snapshot.totals.turns).toBe(10);
    expect(snapshot.totals.modeSwitches).toBe(0);
    expect(snapshot.totals.misclassificationRollbacks).toBe(1);
    expect(snapshot.totals.autonomousAttempts).toBe(4);
    expect(snapshot.totals.autonomousCompletions).toBe(1);
    expect(snapshot.totals.negativeFeedbackTurns).toBe(0);
    expect(snapshot.lastTurnID).toBe('t-next');
    expect(snapshot.lastMode).toBe('chat');
    expect(Number.isFinite(snapshot.metrics.modeSwitchFrequency)).toBe(true);
    expect(Number.isFinite(snapshot.metrics.userNegativeFeedbackRate)).toBe(
      true,
    );
  });

  test('returns finite rates when persisted totals are invalid', () => {
    const projectDir = createTempProjectDir();
    const runtimeDir = getMiyaRuntimeDir(projectDir);
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'mode-observability.json'),
      JSON.stringify(
        {
          totals: {
            turns: 'bad',
            modeSwitches: 'bad',
            misclassificationRollbacks: 'bad',
            autonomousAttempts: 'bad',
            autonomousCompletions: 'bad',
            negativeFeedbackTurns: 'bad',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const snapshot = readModeObservability(projectDir);
    expect(snapshot.totals.turns).toBe(0);
    expect(snapshot.metrics.modeSwitchFrequency).toBe(0);
    expect(snapshot.metrics.misclassificationRollbackRate).toBe(0);
    expect(snapshot.metrics.autonomousTaskCompletionRate).toBe(0);
    expect(snapshot.metrics.userNegativeFeedbackRate).toBe(0);
  });
});

