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
}

interface RouteHistoryStore {
  records: RouteHistoryRecord[];
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'router-history.json');
}

function readStore(projectDir: string): RouteHistoryStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return { records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as RouteHistoryStore;
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

function writeStore(projectDir: string, store: RouteHistoryStore): void {
  const file = filePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

export function addRouteFeedback(
  projectDir: string,
  record: Omit<RouteHistoryRecord, 'at'>,
): RouteHistoryRecord {
  const store = readStore(projectDir);
  const next: RouteHistoryRecord = {
    ...record,
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
  return [
    `route_history_total=${records.length}`,
    `route_history_accept_rate=${Math.round((accepted / records.length) * 100)}%`,
  ].join('\n');
}

