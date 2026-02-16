import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readStrategyExperimentConfig,
  recordStrategyObservation,
  replayStrategyOffline,
  resolveStrategyVariant,
  writeStrategyExperimentConfig,
} from './experiments';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-strategy-test-'));
}

describe('strategy experiments', () => {
  test('assigns deterministic variants and summarizes offline replay', () => {
    const projectDir = tempProjectDir();
    writeStrategyExperimentConfig(projectDir, {
      routing: { enabled: true, rolloutPercent: 100 },
      memory_write: { enabled: true, rolloutPercent: 50 },
      approval_threshold: { enabled: false, rolloutPercent: 0 },
    });
    const cfg = readStrategyExperimentConfig(projectDir);
    expect(cfg.routing.enabled).toBe(true);
    const variant = resolveStrategyVariant(projectDir, 'routing', 'session-1');
    expect(variant).toBe('treatment');
    recordStrategyObservation(projectDir, {
      experiment: 'routing',
      variant,
      subjectID: 'session-1',
      success: true,
      costUsd: 0.0012,
      riskScore: 0.2,
    });
    recordStrategyObservation(projectDir, {
      experiment: 'routing',
      variant: 'control',
      subjectID: 'session-2',
      success: false,
      costUsd: 0.0024,
      riskScore: 0.8,
    });
    const replay = replayStrategyOffline(projectDir, { limit: 100 });
    expect(replay.summary.routing.total).toBe(2);
    expect(replay.summary.routing.byVariant.treatment.total).toBeGreaterThanOrEqual(1);
  });
});
