import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { RouteIntent } from './classifier';

interface RouteHistoryRecord {
  at: string;
  text: string;
  intent: RouteIntent;
  suggestedAgent: string;
  accepted: boolean;
  success?: boolean;
  costUsdEstimate?: number;
  riskScore?: number;
  failureReason?: string;
  stage?: 'low' | 'medium' | 'high';
}

interface RouteHistoryStore {
  records: RouteHistoryRecord[];
}

interface RouteLearningWeights {
  accept: number;
  success: number;
  cost: number;
  risk: number;
}

const DEFAULT_LEARNING_WEIGHTS: RouteLearningWeights = {
  accept: 0.35,
  success: 0.35,
  cost: 0.15,
  risk: 0.15,
};

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'router-history.json');
}

function weightFilePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'router-learning.json');
}

function readStore(projectDir: string): RouteHistoryStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return { records: [] };
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as RouteHistoryStore;
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

function writeStore(projectDir: string, store: RouteHistoryStore): void {
  const file = filePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeWeights(
  input: Partial<RouteLearningWeights>,
): RouteLearningWeights {
  const next: RouteLearningWeights = {
    accept: clamp(
      Number(input.accept ?? DEFAULT_LEARNING_WEIGHTS.accept),
      0,
      1,
    ),
    success: clamp(
      Number(input.success ?? DEFAULT_LEARNING_WEIGHTS.success),
      0,
      1,
    ),
    cost: clamp(Number(input.cost ?? DEFAULT_LEARNING_WEIGHTS.cost), 0, 1),
    risk: clamp(Number(input.risk ?? DEFAULT_LEARNING_WEIGHTS.risk), 0, 1),
  };
  const total = next.accept + next.success + next.cost + next.risk;
  if (total <= 0) return { ...DEFAULT_LEARNING_WEIGHTS };
  return {
    accept: Number((next.accept / total).toFixed(4)),
    success: Number((next.success / total).toFixed(4)),
    cost: Number((next.cost / total).toFixed(4)),
    risk: Number((next.risk / total).toFixed(4)),
  };
}

export function readRouteLearningWeights(
  projectDir: string,
): RouteLearningWeights {
  const file = weightFilePath(projectDir);
  if (!fs.existsSync(file)) return { ...DEFAULT_LEARNING_WEIGHTS };
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<RouteLearningWeights>;
    return sanitizeWeights(parsed);
  } catch {
    return { ...DEFAULT_LEARNING_WEIGHTS };
  }
}

export function writeRouteLearningWeights(
  projectDir: string,
  patch: Partial<RouteLearningWeights>,
): RouteLearningWeights {
  const current = readRouteLearningWeights(projectDir);
  const next = sanitizeWeights({ ...current, ...patch });
  const file = weightFilePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

export function addRouteFeedback(
  projectDir: string,
  record: Omit<RouteHistoryRecord, 'at'>,
): RouteHistoryRecord {
  const store = readStore(projectDir);
  const next: RouteHistoryRecord = {
    ...record,
    costUsdEstimate:
      typeof record.costUsdEstimate === 'number'
        ? Math.max(0, Number(record.costUsdEstimate))
        : undefined,
    riskScore:
      typeof record.riskScore === 'number'
        ? clamp(Number(record.riskScore), 0, 1)
        : undefined,
    at: new Date().toISOString(),
  };
  store.records = [next, ...store.records].slice(0, 1000);
  writeStore(projectDir, store);
  return next;
}

export function summarizeRouteHistory(projectDir: string): string {
  const records = readStore(projectDir).records.slice(0, 50);
  if (records.length === 0) return 'route_history=empty';
  const accepted = records.filter((item) => item.accepted).length;
  const success = records.filter((item) => item.success === true).length;
  const avgRisk =
    records.length > 0
      ? Number(
          (
            records.reduce(
              (sum, item) => sum + Number(item.riskScore ?? 0.5),
              0,
            ) / records.length
          ).toFixed(4),
        )
      : 0.5;
  const avgCost =
    records.length > 0
      ? Number(
          (
            records.reduce(
              (sum, item) => sum + Number(item.costUsdEstimate ?? 0),
              0,
            ) / records.length
          ).toFixed(6),
        )
      : 0;
  return [
    `route_history_total=${records.length}`,
    `route_history_accept_rate=${Math.round((accepted / records.length) * 100)}%`,
    `route_history_success_rate=${Math.round((success / records.length) * 100)}%`,
    `route_history_avg_risk=${avgRisk}`,
    `route_history_avg_cost_usd=${avgCost}`,
  ].join('\n');
}

export function rankAgentsByFeedback(
  projectDir: string,
  intent: RouteIntent,
  availableAgents: string[],
): Array<{
  agent: string;
  score: number;
  samples: number;
  acceptRate: number;
  successRate: number;
  avgCostUsd: number;
  avgRisk: number;
}> {
  const weights = readRouteLearningWeights(projectDir);
  const records = readStore(projectDir)
    .records.filter((item) => item.intent === intent)
    .slice(0, 300);
  const scoredRaw = availableAgents.map((agent) => {
    const matched = records.filter((item) => item.suggestedAgent === agent);
    const accepted = matched.filter((item) => item.accepted).length;
    const success = matched.filter((item) => item.success === true).length;
    const samples = matched.length;
    const acceptRate = samples > 0 ? accepted / samples : 0;
    const successRate = samples > 0 ? success / samples : 0;
    const avgCostUsd =
      samples > 0
        ? matched.reduce(
            (sum, item) => sum + Number(item.costUsdEstimate ?? 0),
            0,
          ) / samples
        : 0;
    const avgRisk =
      samples > 0
        ? matched.reduce(
            (sum, item) => sum + Number(item.riskScore ?? 0.5),
            0,
          ) / samples
        : 0.5;
    return {
      agent,
      samples,
      acceptRate: Number(acceptRate.toFixed(4)),
      successRate: Number(successRate.toFixed(4)),
      avgCostUsd: Number(avgCostUsd.toFixed(6)),
      avgRisk: Number(avgRisk.toFixed(4)),
    };
  });
  const costValues = scoredRaw
    .map((item) => item.avgCostUsd)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const minCost = costValues.length > 0 ? Math.min(...costValues) : 0;
  const maxCost = costValues.length > 0 ? Math.max(...costValues) : 1;
  const scored = scoredRaw.map((item) => {
    const normalizedCost =
      maxCost <= minCost
        ? item.avgCostUsd > 0
          ? 1
          : 0
        : (item.avgCostUsd - minCost) / (maxCost - minCost);
    const samplePrior = Math.min(0.15, item.samples / 80);
    const blended =
      weights.accept * item.acceptRate +
      weights.success * item.successRate +
      weights.cost * (1 - normalizedCost) +
      weights.risk * (1 - item.avgRisk) +
      samplePrior;
    const score = Number(clamp(blended, 0, 1.2).toFixed(4));
    return {
      ...item,
      score,
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}
