import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { GatewayMode } from './sanitizer';

export interface ModeObservabilityStore {
  version: 1;
  totals: {
    turns: number;
    modeSwitches: number;
    misclassificationRollbacks: number;
    autonomousAttempts: number;
    autonomousCompletions: number;
    negativeFeedbackTurns: number;
  };
  lastMode?: GatewayMode;
  lastTurnID?: string;
  updatedAt: string;
}

export interface ModeObservationInput {
  turnID: string;
  finalMode: GatewayMode;
  rollback: boolean;
  autonomousAttempt: boolean;
  autonomousSuccess: boolean;
  negativeFeedback: boolean;
}

export interface ModeObservabilitySnapshot {
  totals: ModeObservabilityStore['totals'];
  metrics: {
    modeSwitchFrequency: number;
    misclassificationRollbackRate: number;
    autonomousTaskCompletionRate: number;
    userNegativeFeedbackRate: number;
  };
  lastMode?: GatewayMode;
  lastTurnID?: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function storePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'mode-observability.json');
}

function defaultStore(): ModeObservabilityStore {
  return {
    version: 1,
    totals: {
      turns: 0,
      modeSwitches: 0,
      misclassificationRollbacks: 0,
      autonomousAttempts: 0,
      autonomousCompletions: 0,
      negativeFeedbackTurns: 0,
    },
    lastMode: undefined,
    lastTurnID: undefined,
    updatedAt: nowIso(),
  };
}

function readStore(projectDir: string): ModeObservabilityStore {
  const file = storePath(projectDir);
  if (!fs.existsSync(file)) return defaultStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ModeObservabilityStore>;
    return {
      ...defaultStore(),
      ...parsed,
      totals: {
        ...defaultStore().totals,
        ...(parsed.totals ?? {}),
      },
    };
  } catch {
    return defaultStore();
  }
}

function writeStore(projectDir: string, store: ModeObservabilityStore): ModeObservabilityStore {
  fs.mkdirSync(path.dirname(storePath(projectDir)), { recursive: true });
  fs.writeFileSync(storePath(projectDir), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  return store;
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

export function readModeObservability(projectDir: string): ModeObservabilitySnapshot {
  const store = readStore(projectDir);
  const turns = Math.max(0, store.totals.turns);
  const modeSwitchFrequency = safeRate(store.totals.modeSwitches, Math.max(1, turns - 1));
  const misclassificationRollbackRate = safeRate(store.totals.misclassificationRollbacks, Math.max(1, turns));
  const autonomousTaskCompletionRate = safeRate(
    store.totals.autonomousCompletions,
    Math.max(1, store.totals.autonomousAttempts),
  );
  const userNegativeFeedbackRate = safeRate(store.totals.negativeFeedbackTurns, Math.max(1, turns));
  return {
    totals: store.totals,
    metrics: {
      modeSwitchFrequency,
      misclassificationRollbackRate,
      autonomousTaskCompletionRate,
      userNegativeFeedbackRate,
    },
    lastMode: store.lastMode,
    lastTurnID: store.lastTurnID,
    updatedAt: store.updatedAt,
  };
}

export function recordModeObservability(
  projectDir: string,
  input: ModeObservationInput,
): ModeObservabilitySnapshot {
  const store = readStore(projectDir);
  const next: ModeObservabilityStore = {
    ...store,
    totals: { ...store.totals },
    updatedAt: nowIso(),
    lastTurnID: input.turnID,
  };
  next.totals.turns += 1;
  if (store.lastMode && store.lastMode !== input.finalMode) {
    next.totals.modeSwitches += 1;
  }
  if (input.rollback) next.totals.misclassificationRollbacks += 1;
  if (input.autonomousAttempt) next.totals.autonomousAttempts += 1;
  if (input.autonomousSuccess) next.totals.autonomousCompletions += 1;
  if (input.negativeFeedback) next.totals.negativeFeedbackTurns += 1;
  next.lastMode = input.finalMode;
  writeStore(projectDir, next);
  return readModeObservability(projectDir);
}

export function detectNegativeFeedbackText(text: string): boolean {
  return /(不对|不行|错了|别这样|烦|停|太差|wrong|bad|stop|not good|hate)/i.test(
    String(text ?? '').trim(),
  );
}

