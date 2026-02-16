import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export type PlanBundleBindingStatus =
  | 'prepared'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface PlanBundleBindingRecord {
  sessionID: string;
  bundleId: string;
  sourceTool: 'miya_autopilot' | 'miya_autoflow';
  mode: 'work' | 'chat' | 'mixed' | 'subagent';
  riskTier: 'LIGHT' | 'STANDARD' | 'THOROUGH';
  policyHash: string;
  status: PlanBundleBindingStatus;
  createdAt: string;
  updatedAt: string;
}

interface PlanBundleBindingStore {
  version: 1;
  sessions: Record<string, PlanBundleBindingRecord>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'plan-bundle-bindings.json');
}

function defaultStore(): PlanBundleBindingStore {
  return {
    version: 1,
    sessions: {},
  };
}

function readStore(projectDir: string): PlanBundleBindingStore {
  const file = storePath(projectDir);
  if (!fs.existsSync(file)) return defaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<PlanBundleBindingStore>;
    if (!parsed || typeof parsed !== 'object') return defaultStore();
    const sessions =
      parsed.sessions && typeof parsed.sessions === 'object'
        ? (parsed.sessions as Record<string, PlanBundleBindingRecord>)
        : {};
    return {
      version: 1,
      sessions,
    };
  } catch {
    return defaultStore();
  }
}

function writeStore(projectDir: string, store: PlanBundleBindingStore): void {
  const file = storePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function normalizeSessionID(sessionID: string): string {
  const value = String(sessionID ?? '').trim();
  return value || 'main';
}

export function readPlanBundleBinding(
  projectDir: string,
  sessionID: string,
): PlanBundleBindingRecord | null {
  const store = readStore(projectDir);
  return store.sessions[normalizeSessionID(sessionID)] ?? null;
}

export function preparePlanBundleBinding(
  projectDir: string,
  input: {
    sessionID: string;
    bundleId: string;
    sourceTool: 'miya_autopilot' | 'miya_autoflow';
    mode?: 'work' | 'chat' | 'mixed' | 'subagent';
    riskTier?: 'LIGHT' | 'STANDARD' | 'THOROUGH';
    policyHash: string;
  },
): PlanBundleBindingRecord {
  const store = readStore(projectDir);
  const sessionID = normalizeSessionID(input.sessionID);
  const previous = store.sessions[sessionID];
  const createdAt = previous?.createdAt ?? nowIso();
  const next: PlanBundleBindingRecord = {
    sessionID,
    bundleId: input.bundleId,
    sourceTool: input.sourceTool,
    mode: input.mode ?? previous?.mode ?? 'work',
    riskTier: input.riskTier ?? previous?.riskTier ?? 'STANDARD',
    policyHash: input.policyHash,
    status: 'prepared',
    createdAt,
    updatedAt: nowIso(),
  };
  store.sessions[sessionID] = next;
  writeStore(projectDir, store);
  return next;
}

export function updatePlanBundleBindingStatus(
  projectDir: string,
  input: {
    sessionID: string;
    status: PlanBundleBindingStatus;
    bundleId?: string;
  },
): PlanBundleBindingRecord | null {
  const store = readStore(projectDir);
  const sessionID = normalizeSessionID(input.sessionID);
  const current = store.sessions[sessionID];
  if (!current) return null;
  if (input.bundleId && current.bundleId !== input.bundleId) return null;
  const next: PlanBundleBindingRecord = {
    ...current,
    status: input.status,
    updatedAt: nowIso(),
  };
  store.sessions[sessionID] = next;
  writeStore(projectDir, store);
  return next;
}

export function clearPlanBundleBinding(projectDir: string, sessionID: string): void {
  const store = readStore(projectDir);
  const key = normalizeSessionID(sessionID);
  if (!(key in store.sessions)) return;
  delete store.sessions[key];
  writeStore(projectDir, store);
}

