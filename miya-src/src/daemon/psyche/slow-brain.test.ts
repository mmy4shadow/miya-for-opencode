import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getActiveSlowBrainPolicy,
  maybeAutoRetrainSlowBrain,
  readSlowBrainState,
  retrainSlowBrainPolicy,
  rollbackSlowBrainPolicy,
} from './slow-brain';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-psyche-slowbrain-'));
}

describe('psyche slow brain', () => {
  test('trains policy from summary and exposes active version', () => {
    const projectDir = tempProjectDir();
    const result = retrainSlowBrainPolicy(projectDir, {
      force: true,
      summary: {
        windowRows: 120,
        observations: 80,
        outcomes: 40,
        decisions: { allow: 12, defer: 22, deny: 6 },
        outcomesSummary: {
          positive: 28,
          negative: 12,
          avgScore: 0.34,
          positiveRate: 0.7,
        },
        resonance: {
          safeHoldDefers: 18,
          probeRequested: 13,
          falseIdleRiskSignals: 9,
          drmCaptureBlockedSignals: 3,
        },
        generatedAt: new Date().toISOString(),
      },
    });
    expect(result.ok).toBe(true);
    expect(result.policy?.versionID.startsWith('sb_')).toBe(true);
    const active = getActiveSlowBrainPolicy(projectDir);
    expect(active.versionID).toBe(result.policy?.versionID);
    expect(active.parameters.consumeAllowThreshold).toBeGreaterThanOrEqual(
      0.35,
    );
    expect(active.parameters.consumeAllowThreshold).toBeLessThanOrEqual(0.88);
  });

  test('skips auto retrain when recently trained', () => {
    const projectDir = tempProjectDir();
    retrainSlowBrainPolicy(projectDir, {
      force: true,
      summary: {
        windowRows: 60,
        observations: 40,
        outcomes: 20,
        decisions: { allow: 8, defer: 10, deny: 2 },
        outcomesSummary: {
          positive: 12,
          negative: 8,
          avgScore: 0.1,
          positiveRate: 0.6,
        },
        resonance: {
          safeHoldDefers: 8,
          probeRequested: 5,
          falseIdleRiskSignals: 4,
          drmCaptureBlockedSignals: 1,
        },
        generatedAt: new Date().toISOString(),
      },
    });
    const auto = maybeAutoRetrainSlowBrain(projectDir, {
      minIntervalSec: 3600,
      minOutcomes: 1,
    });
    expect(auto.ok).toBe(false);
    expect(auto.reason).toBe('skipped_recently_trained');
  });

  test('rolls back to previous policy version', () => {
    const projectDir = tempProjectDir();
    const first = retrainSlowBrainPolicy(projectDir, {
      force: true,
      summary: {
        windowRows: 100,
        observations: 70,
        outcomes: 30,
        decisions: { allow: 9, defer: 16, deny: 5 },
        outcomesSummary: {
          positive: 18,
          negative: 12,
          avgScore: 0.2,
          positiveRate: 0.6,
        },
        resonance: {
          safeHoldDefers: 10,
          probeRequested: 6,
          falseIdleRiskSignals: 7,
          drmCaptureBlockedSignals: 2,
        },
        generatedAt: new Date().toISOString(),
      },
    });
    const second = retrainSlowBrainPolicy(projectDir, {
      force: true,
      summary: {
        windowRows: 160,
        observations: 100,
        outcomes: 60,
        decisions: { allow: 22, defer: 30, deny: 8 },
        outcomesSummary: {
          positive: 42,
          negative: 18,
          avgScore: 0.42,
          positiveRate: 0.7,
        },
        resonance: {
          safeHoldDefers: 14,
          probeRequested: 8,
          falseIdleRiskSignals: 5,
          drmCaptureBlockedSignals: 1,
        },
        generatedAt: new Date().toISOString(),
      },
    });
    expect(first.policy?.versionID).not.toBe(second.policy?.versionID);
    const rollback = rollbackSlowBrainPolicy(projectDir);
    expect(rollback.ok).toBe(true);
    expect(rollback.reason).toBe('rolled_back');
    const state = readSlowBrainState(projectDir);
    expect(state.activeVersionID).toBe(first.policy?.versionID);
  });
});
