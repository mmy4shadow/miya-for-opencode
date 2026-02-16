import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export type StrategyExperimentKey = 'routing' | 'memory_write' | 'approval_threshold';
export type StrategyVariant = 'control' | 'treatment' | 'disabled';

export interface StrategyExperimentRule {
  enabled: boolean;
  rolloutPercent: number;
}

export interface StrategyExperimentConfig {
  routing: StrategyExperimentRule;
  memory_write: StrategyExperimentRule;
  approval_threshold: StrategyExperimentRule;
}

export interface StrategyObservation {
  at: string;
  experiment: StrategyExperimentKey;
  variant: StrategyVariant;
  subjectID: string;
  success: boolean;
  costUsd?: number;
  riskScore?: number;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

const DEFAULT_CONFIG: StrategyExperimentConfig = {
  routing: {
    enabled: false,
    rolloutPercent: 0,
  },
  memory_write: {
    enabled: false,
    rolloutPercent: 0,
  },
  approval_threshold: {
    enabled: false,
    rolloutPercent: 0,
  },
};

function configFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'strategy-experiments.json');
}

function observationFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'strategy-observations.jsonl');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRule(input: unknown, fallback: StrategyExperimentRule): StrategyExperimentRule {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    enabled: obj.enabled === true,
    rolloutPercent: clamp(Number(obj.rolloutPercent ?? fallback.rolloutPercent), 0, 100),
  };
}

function readConfig(projectDir: string): StrategyExperimentConfig {
  const file = configFile(projectDir);
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<StrategyExperimentConfig>;
    return {
      routing: normalizeRule(parsed.routing, DEFAULT_CONFIG.routing),
      memory_write: normalizeRule(parsed.memory_write, DEFAULT_CONFIG.memory_write),
      approval_threshold: normalizeRule(
        parsed.approval_threshold,
        DEFAULT_CONFIG.approval_threshold,
      ),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function readStrategyExperimentConfig(
  projectDir: string,
): StrategyExperimentConfig {
  return readConfig(projectDir);
}

export function writeStrategyExperimentConfig(
  projectDir: string,
  patch: Partial<StrategyExperimentConfig>,
): StrategyExperimentConfig {
  const current = readConfig(projectDir);
  const next: StrategyExperimentConfig = {
    routing:
      patch.routing !== undefined
        ? normalizeRule(patch.routing, current.routing)
        : current.routing,
    memory_write:
      patch.memory_write !== undefined
        ? normalizeRule(patch.memory_write, current.memory_write)
        : current.memory_write,
    approval_threshold:
      patch.approval_threshold !== undefined
        ? normalizeRule(patch.approval_threshold, current.approval_threshold)
        : current.approval_threshold,
  };
  const file = configFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

function bucket(subjectID: string, experiment: StrategyExperimentKey): number {
  const digest = createHash('sha256')
    .update(`${subjectID}|${experiment}`)
    .digest('hex')
    .slice(0, 8);
  return Number.parseInt(digest, 16) % 100;
}

export function resolveStrategyVariant(
  projectDir: string,
  experiment: StrategyExperimentKey,
  subjectID: string,
): StrategyVariant {
  const config = readConfig(projectDir);
  const rule = config[experiment];
  if (!rule.enabled || rule.rolloutPercent <= 0) return 'disabled';
  return bucket(subjectID, experiment) < rule.rolloutPercent ? 'treatment' : 'control';
}

export function recordStrategyObservation(
  projectDir: string,
  input: Omit<StrategyObservation, 'at'> & { at?: string },
): StrategyObservation {
  const file = observationFile(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row: StrategyObservation = {
    at: input.at ?? nowIso(),
    experiment: input.experiment,
    variant: input.variant,
    subjectID: input.subjectID,
    success: input.success,
    costUsd:
      typeof input.costUsd === 'number' && Number.isFinite(input.costUsd)
        ? Math.max(0, input.costUsd)
        : undefined,
    riskScore:
      typeof input.riskScore === 'number' && Number.isFinite(input.riskScore)
        ? clamp(input.riskScore, 0, 1)
        : undefined,
    latencyMs:
      typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)
        ? Math.max(0, Math.floor(input.latencyMs))
        : undefined,
    metadata:
      input.metadata && typeof input.metadata === 'object'
        ? input.metadata
        : undefined,
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf-8');
  return row;
}

function readObservations(projectDir: string, limit = 2000): StrategyObservation[] {
  const file = observationFile(projectDir);
  if (!fs.existsSync(file)) return [];
  const rows: StrategyObservation[] = [];
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(-Math.max(1, Math.min(20_000, limit)))) {
    try {
      rows.push(JSON.parse(line) as StrategyObservation);
    } catch {
      // Ignore malformed lines.
    }
  }
  return rows;
}

export function summarizeStrategyObservations(
  projectDir: string,
  limit = 2000,
): Record<
  StrategyExperimentKey,
  {
    total: number;
    byVariant: Record<
      StrategyVariant,
      { total: number; successRate: number; avgCostUsd: number; avgRisk: number }
    >;
  }
> {
  const rows = readObservations(projectDir, limit);
  const base = {
    disabled: { total: 0, successRate: 0, avgCostUsd: 0, avgRisk: 0 },
    control: { total: 0, successRate: 0, avgCostUsd: 0, avgRisk: 0 },
    treatment: { total: 0, successRate: 0, avgCostUsd: 0, avgRisk: 0 },
  };
  const summary: Record<
    StrategyExperimentKey,
    {
      total: number;
      byVariant: Record<
        StrategyVariant,
        { total: number; successRate: number; avgCostUsd: number; avgRisk: number }
      >;
    }
  > = {
    routing: { total: 0, byVariant: structuredClone(base) },
    memory_write: { total: 0, byVariant: structuredClone(base) },
    approval_threshold: { total: 0, byVariant: structuredClone(base) },
  };
  for (const row of rows) {
    const target = summary[row.experiment];
    target.total += 1;
    const bucket = target.byVariant[row.variant];
    bucket.total += 1;
    bucket.successRate += row.success ? 1 : 0;
    bucket.avgCostUsd += Number(row.costUsd ?? 0);
    bucket.avgRisk += Number(row.riskScore ?? 0);
  }
  for (const experiment of Object.keys(summary) as StrategyExperimentKey[]) {
    for (const variant of ['disabled', 'control', 'treatment'] as StrategyVariant[]) {
      const bucket = summary[experiment].byVariant[variant];
      if (bucket.total === 0) continue;
      bucket.successRate = Number((bucket.successRate / bucket.total).toFixed(4));
      bucket.avgCostUsd = Number((bucket.avgCostUsd / bucket.total).toFixed(6));
      bucket.avgRisk = Number((bucket.avgRisk / bucket.total).toFixed(4));
    }
  }
  return summary;
}

export function replayStrategyOffline(
  projectDir: string,
  input?: { limit?: number },
): {
  config: StrategyExperimentConfig;
  summary: ReturnType<typeof summarizeStrategyObservations>;
} {
  const limit = Math.max(1, Math.min(20_000, Math.floor(input?.limit ?? 5000)));
  return {
    config: readConfig(projectDir),
    summary: summarizeStrategyObservations(projectDir, limit),
  };
}
