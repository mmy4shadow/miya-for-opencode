import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordModeObservability } from '../gateway/mode-observability';
import { readCompanionLearningMetrics } from './learning-metrics';
import {
  confirmCompanionMemoryVector,
  searchCompanionMemoryVectors,
  upsertCompanionMemoryVector,
} from './memory-vector';

function makeProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-learning-metrics-'));
}

function cleanupProjectDir(projectDir: string): void {
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {}
}

describe('companion learning metrics', () => {
  test('aggregates misclassification, convergence and memory hit rates', () => {
    const projectDir = makeProjectDir();
    try {
      recordModeObservability(projectDir, {
        turnID: 'turn_1',
        finalMode: 'work',
        rollback: false,
        autonomousAttempt: false,
        autonomousSuccess: false,
        negativeFeedback: false,
      });
      recordModeObservability(projectDir, {
        turnID: 'turn_2',
        finalMode: 'chat',
        rollback: true,
        autonomousAttempt: true,
        autonomousSuccess: true,
        negativeFeedback: true,
      });

      upsertCompanionMemoryVector(projectDir, {
        text: '我喜欢咖啡',
        activate: true,
        memoryKind: 'UserPreference',
      });
      searchCompanionMemoryVectors(projectDir, '咖啡', 5);
      const candidate = upsertCompanionMemoryVector(projectDir, {
        text: '我不喜欢咖啡',
        memoryKind: 'UserPreference',
      });
      if (candidate.conflictWizardID) {
        confirmCompanionMemoryVector(projectDir, {
          memoryID: candidate.id,
          confirm: true,
          supersedeConflicts: true,
        });
      }
      searchCompanionMemoryVectors(projectDir, '不喜欢咖啡', 5);

      const metrics = readCompanionLearningMetrics(projectDir, {
        maxModeMisclassificationRate: 0.6,
        minCorrectionConvergenceRate: 0.5,
        minMemoryHitRate: 0.5,
      });

      expect(metrics.totals.memories).toBeGreaterThanOrEqual(2);
      expect(metrics.totals.correctionsResolved).toBeGreaterThanOrEqual(1);
      expect(metrics.rates.modeMisclassificationRate).toBeGreaterThan(0);
      expect(metrics.rates.correctionConvergenceRate).toBeGreaterThan(0);
      expect(metrics.rates.memoryHitRate).toBeGreaterThan(0);
      expect(metrics.checks.pass).toBe(true);
    } finally {
      cleanupProjectDir(projectDir);
    }
  });
});
