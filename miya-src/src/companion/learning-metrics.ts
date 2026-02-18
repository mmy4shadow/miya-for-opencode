import { readModeObservability } from '../gateway/mode-observability';
import { getLearningStats } from '../learning';
import {
  listCompanionMemoryCorrections,
  listCompanionMemoryVectors,
} from './memory-vector';

export interface CompanionLearningMetricsTargets {
  maxModeMisclassificationRate: number;
  minCorrectionConvergenceRate: number;
  minMemoryHitRate: number;
}

export interface CompanionLearningMetricsSnapshot {
  generatedAt: string;
  totals: {
    memories: number;
    activeMemories: number;
    pendingMemories: number;
    preferenceMemories: number;
    corrections: number;
    correctionsResolved: number;
    correctionsRejected: number;
    correctionsPending: number;
  };
  rates: {
    modeMisclassificationRate: number;
    correctionConvergenceRate: number;
    memoryHitRate: number;
    negativeFeedbackRate: number;
  };
  learningDrafts: ReturnType<typeof getLearningStats>;
  targets: CompanionLearningMetricsTargets;
  checks: {
    modeMisclassificationRate: boolean;
    correctionConvergenceRate: boolean;
    memoryHitRate: boolean;
    pass: boolean;
  };
}

interface CompanionLearningMetricsInput {
  maxModeMisclassificationRate?: number;
  minCorrectionConvergenceRate?: number;
  minMemoryHitRate?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampRate(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function resolveTargets(
  input?: CompanionLearningMetricsInput,
): CompanionLearningMetricsTargets {
  const misclassificationEnv = Number(
    process.env.MIYA_MODE_MISCLASSIFICATION_MAX_RATE ?? '',
  );
  const correctionEnv = Number(
    process.env.MIYA_CORRECTION_CONVERGENCE_MIN_RATE ?? '',
  );
  const memoryHitEnv = Number(process.env.MIYA_MEMORY_HIT_MIN_RATE ?? '');
  const maxModeMisclassificationRate = clampRate(
    Number.isFinite(input?.maxModeMisclassificationRate as number)
      ? Number(input?.maxModeMisclassificationRate)
      : Number.isFinite(misclassificationEnv)
        ? misclassificationEnv
        : 0.08,
    0.01,
    1,
  );
  const minCorrectionConvergenceRate = clampRate(
    Number.isFinite(input?.minCorrectionConvergenceRate as number)
      ? Number(input?.minCorrectionConvergenceRate)
      : Number.isFinite(correctionEnv)
        ? correctionEnv
        : 0.65,
    0.01,
    1,
  );
  const minMemoryHitRate = clampRate(
    Number.isFinite(input?.minMemoryHitRate as number)
      ? Number(input?.minMemoryHitRate)
      : Number.isFinite(memoryHitEnv)
        ? memoryHitEnv
        : 0.55,
    0.01,
    1,
  );
  return {
    maxModeMisclassificationRate,
    minCorrectionConvergenceRate,
    minMemoryHitRate,
  };
}

export function readCompanionLearningMetrics(
  projectDir: string,
  input?: CompanionLearningMetricsInput,
): CompanionLearningMetricsSnapshot {
  const memories = listCompanionMemoryVectors(projectDir);
  const corrections = listCompanionMemoryCorrections(projectDir);
  const mode = readModeObservability(projectDir);
  const drafts = getLearningStats(projectDir);
  const activeMemories = memories.filter(
    (item) => item.status === 'active' && !item.isArchived,
  );
  const pendingMemories = memories.filter((item) => item.status === 'pending');
  const preferenceMemories = activeMemories.filter(
    (item) => item.semanticLayer === 'preference',
  );
  const correctionResolved = corrections.filter(
    (item) => item.status === 'resolved',
  ).length;
  const correctionRejected = corrections.filter(
    (item) => item.status === 'rejected',
  ).length;
  const correctionPending = corrections.filter(
    (item) => item.status === 'pending',
  ).length;
  const correctionConvergenceRate = safeRate(
    correctionResolved,
    correctionResolved + correctionRejected,
  );
  const memoryHitRate = safeRate(
    activeMemories.filter((item) => item.accessCount > 0).length,
    activeMemories.length,
  );
  const modeMisclassificationRate = clampRate(
    mode.metrics.misclassificationRollbackRate,
    0,
    1,
  );
  const negativeFeedbackRate = clampRate(
    mode.metrics.userNegativeFeedbackRate,
    0,
    1,
  );
  const targets = resolveTargets(input);
  const checks = {
    modeMisclassificationRate:
      modeMisclassificationRate <= targets.maxModeMisclassificationRate,
    correctionConvergenceRate:
      correctionConvergenceRate >= targets.minCorrectionConvergenceRate,
    memoryHitRate: memoryHitRate >= targets.minMemoryHitRate,
    pass: false,
  };
  checks.pass =
    checks.modeMisclassificationRate &&
    checks.correctionConvergenceRate &&
    checks.memoryHitRate;
  return {
    generatedAt: nowIso(),
    totals: {
      memories: memories.length,
      activeMemories: activeMemories.length,
      pendingMemories: pendingMemories.length,
      preferenceMemories: preferenceMemories.length,
      corrections: corrections.length,
      correctionsResolved: correctionResolved,
      correctionsRejected: correctionRejected,
      correctionsPending: correctionPending,
    },
    rates: {
      modeMisclassificationRate,
      correctionConvergenceRate,
      memoryHitRate,
      negativeFeedbackRate,
    },
    learningDrafts: drafts,
    targets,
    checks,
  };
}
