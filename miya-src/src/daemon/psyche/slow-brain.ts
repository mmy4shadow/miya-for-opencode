import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../workflow';
import {
  type PsycheTrainingSummary,
  readPsycheTrainingSummary,
} from './training-summary';

export interface SlowBrainPolicyParameters {
  consumeAllowThreshold: number;
  awayAllowThreshold: number;
  deferRetryBaseSec: number;
  confidenceBoost: number;
}

export interface SlowBrainPolicy {
  versionID: string;
  createdAt: string;
  source: {
    windowRows: number;
    outcomes: number;
  };
  metrics: {
    positiveRate: number;
    avgScore: number;
    safeHoldDefers: number;
    falseIdleRiskSignals: number;
    drmCaptureBlockedSignals: number;
  };
  parameters: SlowBrainPolicyParameters;
}

export interface SlowBrainState {
  activeVersionID?: string;
  versions: SlowBrainPolicy[];
  status: 'idle' | 'trained' | 'rolled_back' | 'skipped';
  updatedAt: string;
  lastRetrainAt?: string;
  lastRollbackAt?: string;
  lastSkipReason?: string;
}

export interface SlowBrainRetrainResult {
  ok: boolean;
  reason:
    | 'trained'
    | 'skipped_insufficient_outcomes'
    | 'skipped_recently_trained';
  state: SlowBrainState;
  policy?: SlowBrainPolicy;
}

export interface SlowBrainRollbackResult {
  ok: boolean;
  reason:
    | 'rolled_back'
    | 'rollback_target_not_found'
    | 'rollback_history_insufficient'
    | 'rollback_already_active';
  state: SlowBrainState;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(input: number, min: number, max: number): number {
  if (!Number.isFinite(input)) return min;
  return Math.max(min, Math.min(max, Number(input.toFixed(4))));
}

function slowBrainFile(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'daemon',
    'psyche',
    'slow-brain.json',
  );
}

function defaultParameters(): SlowBrainPolicyParameters {
  return {
    consumeAllowThreshold: 0.6,
    awayAllowThreshold: 0.35,
    deferRetryBaseSec: 120,
    confidenceBoost: 0.55,
  };
}

function defaultPolicy(): SlowBrainPolicy {
  return {
    versionID: 'sb_default',
    createdAt: nowIso(),
    source: {
      windowRows: 0,
      outcomes: 0,
    },
    metrics: {
      positiveRate: 0,
      avgScore: 0,
      safeHoldDefers: 0,
      falseIdleRiskSignals: 0,
      drmCaptureBlockedSignals: 0,
    },
    parameters: defaultParameters(),
  };
}

function normalizePolicy(raw: unknown): SlowBrainPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const versionID = String(row.versionID ?? '').trim();
  if (!versionID) return null;
  const createdAt =
    typeof row.createdAt === 'string' ? row.createdAt : nowIso();
  const sourceRaw =
    row.source && typeof row.source === 'object' && !Array.isArray(row.source)
      ? (row.source as Record<string, unknown>)
      : {};
  const metricsRaw =
    row.metrics &&
    typeof row.metrics === 'object' &&
    !Array.isArray(row.metrics)
      ? (row.metrics as Record<string, unknown>)
      : {};
  const paramsRaw =
    row.parameters &&
    typeof row.parameters === 'object' &&
    !Array.isArray(row.parameters)
      ? (row.parameters as Record<string, unknown>)
      : {};
  const source = {
    windowRows: Math.max(0, Number(sourceRaw.windowRows ?? 0) || 0),
    outcomes: Math.max(0, Number(sourceRaw.outcomes ?? 0) || 0),
  };
  const metrics = {
    positiveRate: clamp(Number(metricsRaw.positiveRate ?? 0), 0, 1),
    avgScore: clamp(Number(metricsRaw.avgScore ?? 0), -1, 1),
    safeHoldDefers: Math.max(0, Number(metricsRaw.safeHoldDefers ?? 0) || 0),
    falseIdleRiskSignals: Math.max(
      0,
      Number(metricsRaw.falseIdleRiskSignals ?? 0) || 0,
    ),
    drmCaptureBlockedSignals: Math.max(
      0,
      Number(metricsRaw.drmCaptureBlockedSignals ?? 0) || 0,
    ),
  };
  const defaults = defaultParameters();
  const parameters = {
    consumeAllowThreshold: clamp(
      Number(paramsRaw.consumeAllowThreshold ?? defaults.consumeAllowThreshold),
      0.3,
      0.9,
    ),
    awayAllowThreshold: clamp(
      Number(paramsRaw.awayAllowThreshold ?? defaults.awayAllowThreshold),
      0.15,
      0.8,
    ),
    deferRetryBaseSec: Math.max(
      15,
      Math.min(
        900,
        Math.floor(
          Number(paramsRaw.deferRetryBaseSec ?? defaults.deferRetryBaseSec) ||
            0,
        ),
      ),
    ),
    confidenceBoost: clamp(
      Number(paramsRaw.confidenceBoost ?? defaults.confidenceBoost),
      0.2,
      0.95,
    ),
  };
  return {
    versionID,
    createdAt,
    source,
    metrics,
    parameters,
  };
}

function normalizeState(raw: unknown): SlowBrainState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      versions: [],
      status: 'idle',
      updatedAt: nowIso(),
    };
  }
  const row = raw as Record<string, unknown>;
  const versions = Array.isArray(row.versions)
    ? row.versions
        .map(normalizePolicy)
        .filter((item): item is SlowBrainPolicy => Boolean(item))
    : [];
  return {
    activeVersionID:
      typeof row.activeVersionID === 'string' &&
      row.activeVersionID.trim().length > 0
        ? row.activeVersionID.trim()
        : undefined,
    versions,
    status:
      row.status === 'trained' ||
      row.status === 'rolled_back' ||
      row.status === 'skipped' ||
      row.status === 'idle'
        ? row.status
        : 'idle',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
    lastRetrainAt:
      typeof row.lastRetrainAt === 'string' ? row.lastRetrainAt : undefined,
    lastRollbackAt:
      typeof row.lastRollbackAt === 'string' ? row.lastRollbackAt : undefined,
    lastSkipReason:
      typeof row.lastSkipReason === 'string' ? row.lastSkipReason : undefined,
  };
}

function writeState(projectDir: string, state: SlowBrainState): void {
  const file = slowBrainFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function summarizeToPolicy(summary: PsycheTrainingSummary): SlowBrainPolicy {
  const positiveRate = clamp(summary.outcomesSummary.positiveRate, 0, 1);
  const avgScore = clamp(summary.outcomesSummary.avgScore, -1, 1);
  const safeHoldPressure = clamp(
    summary.resonance.safeHoldDefers / Math.max(1, summary.observations),
    0,
    1,
  );
  const falseIdlePressure = clamp(
    summary.resonance.falseIdleRiskSignals / Math.max(1, summary.observations),
    0,
    1,
  );
  const drmPressure = clamp(
    summary.resonance.drmCaptureBlockedSignals /
      Math.max(1, summary.observations),
    0,
    1,
  );

  const consumeAllowThreshold = clamp(
    0.52 +
      (0.5 - positiveRate) * 0.25 +
      falseIdlePressure * 0.18 +
      drmPressure * 0.1,
    0.35,
    0.88,
  );
  const awayAllowThreshold = clamp(
    0.28 + (0.5 - positiveRate) * 0.2 + falseIdlePressure * 0.08,
    0.18,
    0.72,
  );
  const deferRetryBaseSec = Math.max(
    30,
    Math.min(
      900,
      Math.floor(
        90 + summary.resonance.safeHoldDefers * 3 + falseIdlePressure * 120,
      ),
    ),
  );
  const confidenceBoost = clamp(
    0.5 +
      positiveRate * 0.3 -
      falseIdlePressure * 0.15 -
      drmPressure * 0.08 +
      avgScore * 0.1,
    0.2,
    0.92,
  );
  const digest = createHash('sha1')
    .update(
      JSON.stringify({
        windowRows: summary.windowRows,
        outcomes: summary.outcomes,
        positiveRate,
        avgScore,
        safeHoldPressure,
        falseIdlePressure,
        drmPressure,
      }),
    )
    .digest('hex')
    .slice(0, 10);
  return {
    versionID: `sb_${Date.now().toString(36)}_${digest}`,
    createdAt: nowIso(),
    source: {
      windowRows: summary.windowRows,
      outcomes: summary.outcomes,
    },
    metrics: {
      positiveRate,
      avgScore,
      safeHoldDefers: summary.resonance.safeHoldDefers,
      falseIdleRiskSignals: summary.resonance.falseIdleRiskSignals,
      drmCaptureBlockedSignals: summary.resonance.drmCaptureBlockedSignals,
    },
    parameters: {
      consumeAllowThreshold,
      awayAllowThreshold,
      deferRetryBaseSec,
      confidenceBoost,
    },
  };
}

export function readSlowBrainState(projectDir: string): SlowBrainState {
  const file = slowBrainFile(projectDir);
  if (!fs.existsSync(file)) {
    const state: SlowBrainState = {
      versions: [],
      status: 'idle',
      updatedAt: nowIso(),
    };
    writeState(projectDir, state);
    return state;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    const state = normalizeState(parsed);
    writeState(projectDir, state);
    return state;
  } catch {
    const state: SlowBrainState = {
      versions: [],
      status: 'idle',
      updatedAt: nowIso(),
    };
    writeState(projectDir, state);
    return state;
  }
}

export function getActiveSlowBrainPolicy(projectDir: string): SlowBrainPolicy {
  const state = readSlowBrainState(projectDir);
  if (state.activeVersionID) {
    const active = state.versions.find(
      (item) => item.versionID === state.activeVersionID,
    );
    if (active) return active;
  }
  if (state.versions.length > 0)
    return state.versions[state.versions.length - 1] as SlowBrainPolicy;
  return defaultPolicy();
}

export function retrainSlowBrainPolicy(
  projectDir: string,
  options?: {
    force?: boolean;
    minOutcomes?: number;
    trainingWindow?: number;
    summary?: PsycheTrainingSummary;
  },
): SlowBrainRetrainResult {
  const minOutcomes = Math.max(1, Math.floor(options?.minOutcomes ?? 20));
  const summary =
    options?.summary ??
    readPsycheTrainingSummary(projectDir, options?.trainingWindow ?? 600);
  const state = readSlowBrainState(projectDir);
  if (!options?.force && summary.outcomes < minOutcomes) {
    const skipped: SlowBrainState = {
      ...state,
      status: 'skipped',
      updatedAt: nowIso(),
      lastSkipReason: 'insufficient_outcomes',
    };
    writeState(projectDir, skipped);
    return {
      ok: false,
      reason: 'skipped_insufficient_outcomes',
      state: skipped,
    };
  }
  const policy = summarizeToPolicy(summary);
  const versions = [...state.versions, policy].slice(-12);
  const next: SlowBrainState = {
    ...state,
    activeVersionID: policy.versionID,
    versions,
    status: 'trained',
    updatedAt: nowIso(),
    lastRetrainAt: nowIso(),
    lastSkipReason: undefined,
  };
  writeState(projectDir, next);
  return {
    ok: true,
    reason: 'trained',
    policy,
    state: next,
  };
}

export function maybeAutoRetrainSlowBrain(
  projectDir: string,
  options?: {
    minIntervalSec?: number;
    minOutcomes?: number;
    trainingWindow?: number;
  },
): SlowBrainRetrainResult {
  const minIntervalSec = Math.max(
    300,
    Math.floor(options?.minIntervalSec ?? 3600),
  );
  const state = readSlowBrainState(projectDir);
  const lastMs = Date.parse(state.lastRetrainAt ?? '');
  if (Number.isFinite(lastMs) && Date.now() - lastMs < minIntervalSec * 1000) {
    return {
      ok: false,
      reason: 'skipped_recently_trained',
      state,
    };
  }
  return retrainSlowBrainPolicy(projectDir, {
    force: false,
    minOutcomes: options?.minOutcomes,
    trainingWindow: options?.trainingWindow,
  });
}

export function rollbackSlowBrainPolicy(
  projectDir: string,
  targetVersionID?: string,
): SlowBrainRollbackResult {
  const state = readSlowBrainState(projectDir);
  if (state.versions.length <= 1 && !targetVersionID) {
    return {
      ok: false,
      reason: 'rollback_history_insufficient',
      state,
    };
  }
  const currentID = state.activeVersionID;
  const target = targetVersionID
    ? state.versions.find((item) => item.versionID === targetVersionID)
    : [...state.versions]
        .reverse()
        .find((item) => item.versionID !== currentID);
  if (!target) {
    return {
      ok: false,
      reason: targetVersionID
        ? 'rollback_target_not_found'
        : 'rollback_history_insufficient',
      state,
    };
  }
  if (currentID && currentID === target.versionID) {
    return {
      ok: false,
      reason: 'rollback_already_active',
      state,
    };
  }
  const next: SlowBrainState = {
    ...state,
    activeVersionID: target.versionID,
    status: 'rolled_back',
    updatedAt: nowIso(),
    lastRollbackAt: nowIso(),
  };
  writeState(projectDir, next);
  return {
    ok: true,
    reason: 'rolled_back',
    state: next,
  };
}
