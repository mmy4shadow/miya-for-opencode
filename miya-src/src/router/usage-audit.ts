import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { RouteIntent } from './classifier';
import type { RouteComplexity, RouteStage } from './runtime';

export interface RouterUsageRecord {
  at: string;
  sessionID: string;
  intent: RouteIntent;
  complexity: RouteComplexity;
  stage: RouteStage;
  agent: string;
  estimatedTokens: number;
  estimatedCostUsd: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualTotalTokens: number;
  actualCostUsd: number;
}

export interface RouterUsageSummary {
  totalRecords: number;
  estimatedTokens: number;
  actualTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  tokenDelta: number;
  tokenDeltaPercent: number;
  costDeltaUsd: number;
}

function usageFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'router-usage.jsonl');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(getMiyaRuntimeDir(projectDir), { recursive: true });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function appendRouteUsageRecord(
  projectDir: string,
  input: Omit<RouterUsageRecord, 'at'> & { at?: string },
): RouterUsageRecord {
  const record: RouterUsageRecord = {
    ...input,
    at: input.at ?? new Date().toISOString(),
    estimatedTokens: clamp(Number(input.estimatedTokens || 0), 0, 50_000_000),
    estimatedCostUsd: Number(Number(input.estimatedCostUsd || 0).toFixed(6)),
    actualInputTokens: clamp(
      Number(input.actualInputTokens || 0),
      0,
      50_000_000,
    ),
    actualOutputTokens: clamp(
      Number(input.actualOutputTokens || 0),
      0,
      50_000_000,
    ),
    actualTotalTokens: clamp(
      Number(input.actualTotalTokens || 0),
      0,
      50_000_000,
    ),
    actualCostUsd: Number(Number(input.actualCostUsd || 0).toFixed(6)),
  };
  ensureDir(projectDir);
  fs.appendFileSync(
    usageFile(projectDir),
    `${JSON.stringify(record)}\n`,
    'utf-8',
  );
  return record;
}

export function listRouteUsageRecords(
  projectDir: string,
  limit = 40,
): RouterUsageRecord[] {
  const file = usageFile(projectDir);
  if (!fs.existsSync(file)) return [];
  const rows = fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RouterUsageRecord;
      } catch {
        return null;
      }
    })
    .filter((item): item is RouterUsageRecord => Boolean(item));
  return rows.slice(-Math.max(1, Math.min(500, limit)));
}

export function summarizeRouteUsage(
  projectDir: string,
  limit = 300,
): RouterUsageSummary {
  const rows = listRouteUsageRecords(projectDir, limit);
  let estimatedTokens = 0;
  let actualTokens = 0;
  let estimatedCostUsd = 0;
  let actualCostUsd = 0;
  for (const row of rows) {
    estimatedTokens += row.estimatedTokens;
    actualTokens += row.actualTotalTokens;
    estimatedCostUsd += row.estimatedCostUsd;
    actualCostUsd += row.actualCostUsd;
  }
  const tokenDelta = actualTokens - estimatedTokens;
  const tokenDeltaPercent =
    estimatedTokens > 0
      ? Number(((tokenDelta / estimatedTokens) * 100).toFixed(2))
      : 0;
  return {
    totalRecords: rows.length,
    estimatedTokens,
    actualTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    actualCostUsd: Number(actualCostUsd.toFixed(6)),
    tokenDelta,
    tokenDeltaPercent,
    costDeltaUsd: Number((actualCostUsd - estimatedCostUsd).toFixed(6)),
  };
}
