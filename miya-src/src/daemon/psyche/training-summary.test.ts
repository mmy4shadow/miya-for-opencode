import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../workflow';
import { PsycheConsultService } from './consult';
import { readPsycheTrainingSummary } from './training-summary';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-psyche-summary-'));
}

describe('psyche training summary', () => {
  test('aggregates observation and outcome windows', () => {
    const projectDir = tempProjectDir();
    const service = new PsycheConsultService(projectDir, {
      epsilon: 0,
      shadowModeDays: 0,
      nativeSignalsProvider: () => ({
        sampledAt: new Date(0).toISOString(),
        signals: {},
        captureLimitations: [],
      }),
      screenProbeProvider: () => ({
        status: 'ok',
        method: 'print_window',
        captureLimitations: [],
        sceneTags: [],
        confidence: 0.6,
        inferredSignals: {},
      }),
    });
    const consult = service.consult({
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
    service.registerOutcome({
      consultAuditID: consult.auditID,
      intent: consult.intent,
      urgency: consult.urgency,
      channel: consult.channel,
      userInitiated: consult.userInitiated,
      state: consult.state,
      delivered: false,
      blockedReason: 'outbound_blocked:psyche_deferred',
    });
    const summary = readPsycheTrainingSummary(projectDir, 50);
    expect(summary.windowRows).toBeGreaterThan(1);
    expect(summary.observations).toBeGreaterThan(0);
    expect(summary.outcomes).toBeGreaterThan(0);
    expect(
      summary.decisions.defer +
        summary.decisions.allow +
        summary.decisions.deny,
    ).toBeGreaterThan(0);
    expect(
      summary.outcomesSummary.positive + summary.outcomesSummary.negative,
    ).toBeGreaterThan(0);
  });

  test('returns zero summary when training data is absent', () => {
    const projectDir = tempProjectDir();
    const runtimeDir = getMiyaRuntimeDir(projectDir);
    const trainingFile = path.join(
      runtimeDir,
      'daemon',
      'psyche',
      'training-data.jsonl',
    );
    fs.rmSync(trainingFile, { force: true });
    const summary = readPsycheTrainingSummary(projectDir, 30);
    expect(summary.windowRows).toBe(0);
    expect(summary.observations).toBe(0);
    expect(summary.outcomes).toBe(0);
  });
});
