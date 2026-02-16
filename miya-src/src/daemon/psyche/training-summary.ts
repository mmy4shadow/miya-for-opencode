import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../workflow';

type TrainingRow =
  | {
      type: 'observation';
      obs?: {
        decision?: 'allow' | 'defer' | 'deny';
        shouldProbeScreen?: boolean;
        reasons?: string[];
      };
    }
  | {
      type: 'action_outcome';
      action?: {
        score?: number;
        reward?: 'positive' | 'negative';
        blockedReason?: string;
      };
    };

export interface PsycheTrainingSummary {
  windowRows: number;
  observations: number;
  outcomes: number;
  decisions: {
    allow: number;
    defer: number;
    deny: number;
  };
  outcomesSummary: {
    positive: number;
    negative: number;
    avgScore: number;
    positiveRate: number;
  };
  resonance: {
    safeHoldDefers: number;
    probeRequested: number;
    falseIdleRiskSignals: number;
    drmCaptureBlockedSignals: number;
  };
  generatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trainingFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'daemon', 'psyche', 'training-data.jsonl');
}

function safeParse(line: string): TrainingRow | null {
  try {
    return JSON.parse(line) as TrainingRow;
  } catch {
    return null;
  }
}

export function readPsycheTrainingSummary(projectDir: string, limit = 400): PsycheTrainingSummary {
  const file = trainingFile(projectDir);
  if (!fs.existsSync(file)) {
    return {
      windowRows: 0,
      observations: 0,
      outcomes: 0,
      decisions: { allow: 0, defer: 0, deny: 0 },
      outcomesSummary: {
        positive: 0,
        negative: 0,
        avgScore: 0,
        positiveRate: 0,
      },
      resonance: {
        safeHoldDefers: 0,
        probeRequested: 0,
        falseIdleRiskSignals: 0,
        drmCaptureBlockedSignals: 0,
      },
      generatedAt: nowIso(),
    };
  }

  const rows = fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(20, Math.min(5000, limit)))
    .map((line) => safeParse(line))
    .filter((row): row is TrainingRow => Boolean(row));

  let observations = 0;
  let outcomes = 0;
  const decisions = { allow: 0, defer: 0, deny: 0 };
  let positive = 0;
  let negative = 0;
  let scoreTotal = 0;
  let scoreCount = 0;
  let safeHoldDefers = 0;
  let probeRequested = 0;
  let falseIdleRiskSignals = 0;
  let drmCaptureBlockedSignals = 0;

  for (const row of rows) {
    if (row.type === 'observation') {
      observations += 1;
      if (row.obs?.decision === 'allow') decisions.allow += 1;
      else if (row.obs?.decision === 'deny') decisions.deny += 1;
      else if (row.obs?.decision === 'defer') decisions.defer += 1;
      if (row.obs?.shouldProbeScreen) probeRequested += 1;
      const reasons = Array.isArray(row.obs?.reasons)
        ? row.obs?.reasons.map((item) => String(item))
        : [];
      if (reasons.some((item) => item.includes('shadow_mode_safe_hold') || item.includes('safe_hold'))) {
        safeHoldDefers += 1;
      }
      if (
        reasons.some(
          (item) =>
            item.includes('input_signal_conflict') ||
            item.includes('idle_with_media_signal_needs_probe') ||
            item.includes('probe_failed_with_media_signals'),
        )
      ) {
        falseIdleRiskSignals += 1;
      }
      if (
        reasons.some(
          (item) =>
            item.includes('screen_probe_capture_protected') ||
            item.includes('capture_limitations_present'),
        )
      ) {
        drmCaptureBlockedSignals += 1;
      }
      continue;
    }

    if (row.type === 'action_outcome') {
      outcomes += 1;
      if (row.action?.reward === 'positive') positive += 1;
      if (row.action?.reward === 'negative') negative += 1;
      if (Number.isFinite(row.action?.score)) {
        scoreTotal += Number(row.action?.score);
        scoreCount += 1;
      }
      if (String(row.action?.blockedReason ?? '').includes('safe_hold')) {
        safeHoldDefers += 1;
      }
    }
  }

  const positiveRate = outcomes > 0 ? Number((positive / outcomes).toFixed(4)) : 0;
  const avgScore = scoreCount > 0 ? Number((scoreTotal / scoreCount).toFixed(4)) : 0;

  return {
    windowRows: rows.length,
    observations,
    outcomes,
    decisions,
    outcomesSummary: {
      positive,
      negative,
      avgScore,
      positiveRate,
    },
    resonance: {
      safeHoldDefers,
      probeRequested,
      falseIdleRiskSignals,
      drmCaptureBlockedSignals,
    },
    generatedAt: nowIso(),
  };
}
