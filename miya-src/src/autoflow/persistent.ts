import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import { runAutoflow } from './engine';
import {
  appendAutoflowHistory,
  getAutoflowSession,
  loadAutoflowSession,
  saveAutoflowSession,
  stopAutoflowSession,
} from './state';
import type { AutoflowManager } from './types';

export interface AutoflowPersistentConfig {
  enabled: boolean;
  resumeCooldownMs: number;
  maxAutoResumes: number;
  maxConsecutiveResumeFailures: number;
  resumeTimeoutMs: number;
}

export interface AutoflowPersistentSessionRuntime {
  sessionID: string;
  resumeAttempts: number;
  resumeFailures: number;
  userStopped: boolean;
  lastStopAt?: string;
  lastStopType?: string;
  lastStopReason?: string;
  lastResumeAt?: string;
  lastOutcomePhase?: string;
  lastOutcomeSummary?: string;
}

interface AutoflowPersistentStore {
  config: AutoflowPersistentConfig;
  sessions: Record<string, AutoflowPersistentSessionRuntime>;
}

export interface AutoflowPersistentEventInput {
  type?: string;
  properties?: {
    sessionID?: string;
    status?: {
      type?: string;
      reason?: string;
      source?: string;
    };
    reason?: string;
    source?: string;
  };
}

export interface AutoflowPersistentEventResult {
  handled: boolean;
  resumed: boolean;
  reason?: string;
  success?: boolean;
  phase?: string;
  summary?: string;
}

const DEFAULT_CONFIG: AutoflowPersistentConfig = {
  enabled: true,
  resumeCooldownMs: 2_500,
  maxAutoResumes: 8,
  maxConsecutiveResumeFailures: 3,
  resumeTimeoutMs: 90_000,
};

function storeFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'autoflow-persistent.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeConfig(raw?: Partial<AutoflowPersistentConfig>): AutoflowPersistentConfig {
  return {
    enabled: raw?.enabled !== false,
    resumeCooldownMs: clamp(Number(raw?.resumeCooldownMs ?? DEFAULT_CONFIG.resumeCooldownMs), 500, 120_000),
    maxAutoResumes: clamp(Number(raw?.maxAutoResumes ?? DEFAULT_CONFIG.maxAutoResumes), 1, 50),
    maxConsecutiveResumeFailures: clamp(
      Number(raw?.maxConsecutiveResumeFailures ?? DEFAULT_CONFIG.maxConsecutiveResumeFailures),
      1,
      20,
    ),
    resumeTimeoutMs: clamp(Number(raw?.resumeTimeoutMs ?? DEFAULT_CONFIG.resumeTimeoutMs), 3_000, 10 * 60_000),
  };
}

function normalizeRuntime(
  sessionID: string,
  raw?: Partial<AutoflowPersistentSessionRuntime>,
): AutoflowPersistentSessionRuntime {
  return {
    sessionID,
    resumeAttempts: clamp(Number(raw?.resumeAttempts ?? 0), 0, 1_000),
    resumeFailures: clamp(Number(raw?.resumeFailures ?? 0), 0, 1_000),
    userStopped: Boolean(raw?.userStopped),
    lastStopAt: raw?.lastStopAt ? String(raw.lastStopAt) : undefined,
    lastStopType: raw?.lastStopType ? String(raw.lastStopType) : undefined,
    lastStopReason: raw?.lastStopReason ? String(raw.lastStopReason) : undefined,
    lastResumeAt: raw?.lastResumeAt ? String(raw.lastResumeAt) : undefined,
    lastOutcomePhase: raw?.lastOutcomePhase ? String(raw.lastOutcomePhase) : undefined,
    lastOutcomeSummary: raw?.lastOutcomeSummary ? String(raw.lastOutcomeSummary) : undefined,
  };
}

function readStore(projectDir: string): AutoflowPersistentStore {
  const file = storeFile(projectDir);
  if (!fs.existsSync(file)) return { config: DEFAULT_CONFIG, sessions: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<AutoflowPersistentStore>;
    const sessionsRaw =
      parsed.sessions && typeof parsed.sessions === 'object'
        ? (parsed.sessions as Record<string, Partial<AutoflowPersistentSessionRuntime>>)
        : {};
    const sessions = Object.fromEntries(
      Object.entries(sessionsRaw).map(([sessionID, runtime]) => [
        sessionID,
        normalizeRuntime(sessionID, runtime),
      ]),
    );
    return {
      config: normalizeConfig(parsed.config),
      sessions,
    };
  } catch {
    return { config: DEFAULT_CONFIG, sessions: {} };
  }
}

function writeStore(projectDir: string, store: AutoflowPersistentStore): AutoflowPersistentStore {
  fs.mkdirSync(path.dirname(storeFile(projectDir)), { recursive: true });
  const normalized: AutoflowPersistentStore = {
    config: normalizeConfig(store.config),
    sessions: Object.fromEntries(
      Object.entries(store.sessions).map(([sessionID, runtime]) => [
        sessionID,
        normalizeRuntime(sessionID, runtime),
      ]),
    ),
  };
  fs.writeFileSync(storeFile(projectDir), `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
  return normalized;
}

function getSessionRuntime(projectDir: string, sessionID: string): AutoflowPersistentSessionRuntime {
  const store = readStore(projectDir);
  return store.sessions[sessionID] ?? normalizeRuntime(sessionID);
}

function saveSessionRuntime(
  projectDir: string,
  runtime: AutoflowPersistentSessionRuntime,
): AutoflowPersistentSessionRuntime {
  const store = readStore(projectDir);
  store.sessions[runtime.sessionID] = normalizeRuntime(runtime.sessionID, runtime);
  return writeStore(projectDir, store).sessions[runtime.sessionID] as AutoflowPersistentSessionRuntime;
}

function parseStopReason(event: AutoflowPersistentEventInput): string {
  const statusReason = event.properties?.status?.reason;
  const topReason = event.properties?.reason;
  const source = event.properties?.status?.source ?? event.properties?.source;
  const text = [statusReason, topReason, source]
    .map((item) => (item ? String(item).trim() : ''))
    .filter(Boolean)
    .join(' | ');
  return text || 'unknown_stop_reason';
}

function isStopStatus(statusType: string): boolean {
  return ['stopped', 'stop', 'error', 'failed', 'terminated', 'aborted', 'cancelled', 'canceled'].some((item) =>
    statusType.includes(item),
  );
}

function isUserInitiatedStop(reason: string): boolean {
  return /(user|manual|operator|cancel_by_user|interrupted_by_user|用户|手动|停止|取消)/i.test(reason);
}

function isActiveAutoflowPhase(phase: string): boolean {
  return phase === 'planning' || phase === 'execution' || phase === 'verification' || phase === 'fixing';
}

function markPersistentExhausted(projectDir: string, sessionID: string, reason: string): void {
  const state = getAutoflowSession(projectDir, sessionID);
  state.phase = 'failed';
  state.lastError = reason;
  appendAutoflowHistory(state, 'persistent_exhausted', reason);
  saveAutoflowSession(projectDir, state);
}

export function readAutoflowPersistentConfig(projectDir: string): AutoflowPersistentConfig {
  return readStore(projectDir).config;
}

export function writeAutoflowPersistentConfig(
  projectDir: string,
  patch: Partial<AutoflowPersistentConfig>,
): AutoflowPersistentConfig {
  const store = readStore(projectDir);
  store.config = normalizeConfig({
    ...store.config,
    ...patch,
  });
  return writeStore(projectDir, store).config;
}

export function getAutoflowPersistentRuntimeSnapshot(
  projectDir: string,
  limit = 50,
): AutoflowPersistentSessionRuntime[] {
  const store = readStore(projectDir);
  return Object.values(store.sessions)
    .sort((a, b) => Date.parse(b.lastStopAt ?? b.lastResumeAt ?? '') - Date.parse(a.lastStopAt ?? a.lastResumeAt ?? ''))
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export async function handleAutoflowPersistentEvent(input: {
  projectDir: string;
  manager: AutoflowManager;
  event: AutoflowPersistentEventInput;
}): Promise<AutoflowPersistentEventResult> {
  if (input.event.type !== 'session.status') return { handled: false, resumed: false };
  const sessionID = String(input.event.properties?.sessionID ?? '').trim();
  if (!sessionID) return { handled: false, resumed: false };
  const statusType = String(input.event.properties?.status?.type ?? '').trim().toLowerCase();
  if (!statusType || !isStopStatus(statusType)) return { handled: false, resumed: false };

  const current = loadAutoflowSession(input.projectDir, sessionID);
  if (!current || !isActiveAutoflowPhase(current.phase)) {
    return { handled: false, resumed: false };
  }

  const reason = parseStopReason(input.event);
  const runtime = getSessionRuntime(input.projectDir, sessionID);
  runtime.lastStopAt = nowIso();
  runtime.lastStopType = statusType;
  runtime.lastStopReason = reason;
  saveSessionRuntime(input.projectDir, runtime);

  if (isUserInitiatedStop(reason)) {
    runtime.userStopped = true;
    runtime.lastOutcomePhase = 'stopped';
    runtime.lastOutcomeSummary = 'user_initiated_stop';
    saveSessionRuntime(input.projectDir, runtime);
    stopAutoflowSession(input.projectDir, sessionID);
    return {
      handled: true,
      resumed: false,
      reason: 'user_initiated_stop',
      phase: 'stopped',
      summary: 'autoflow_stopped_by_user',
    };
  }

  const config = readAutoflowPersistentConfig(input.projectDir);
  if (!config.enabled) {
    return { handled: true, resumed: false, reason: 'persistent_disabled' };
  }
  if (runtime.userStopped) {
    return { handled: true, resumed: false, reason: 'user_stopped_session' };
  }
  if (runtime.resumeAttempts >= config.maxAutoResumes) {
    const exhaustedReason = 'persistent_resume_attempt_limit_reached';
    markPersistentExhausted(input.projectDir, sessionID, exhaustedReason);
    runtime.lastOutcomePhase = 'failed';
    runtime.lastOutcomeSummary = exhaustedReason;
    saveSessionRuntime(input.projectDir, runtime);
    return { handled: true, resumed: false, reason: exhaustedReason, phase: 'failed' };
  }
  if (runtime.resumeFailures >= config.maxConsecutiveResumeFailures) {
    const exhaustedReason = 'persistent_resume_failure_limit_reached';
    markPersistentExhausted(input.projectDir, sessionID, exhaustedReason);
    runtime.lastOutcomePhase = 'failed';
    runtime.lastOutcomeSummary = exhaustedReason;
    saveSessionRuntime(input.projectDir, runtime);
    return { handled: true, resumed: false, reason: exhaustedReason, phase: 'failed' };
  }

  if (runtime.lastResumeAt) {
    const delta = Date.now() - Date.parse(runtime.lastResumeAt);
    if (Number.isFinite(delta) && delta < config.resumeCooldownMs) {
      return { handled: true, resumed: false, reason: 'resume_cooldown' };
    }
  }

  runtime.resumeAttempts += 1;
  runtime.lastResumeAt = nowIso();
  saveSessionRuntime(input.projectDir, runtime);

  const result = await runAutoflow({
    projectDir: input.projectDir,
    sessionID,
    manager: input.manager,
    timeoutMs: config.resumeTimeoutMs,
  });

  runtime.lastOutcomePhase = result.phase;
  runtime.lastOutcomeSummary = result.summary;
  runtime.resumeFailures = result.success ? 0 : runtime.resumeFailures + 1;
  saveSessionRuntime(input.projectDir, runtime);

  return {
    handled: true,
    resumed: true,
    success: result.success,
    phase: result.phase,
    summary: result.summary,
  };
}

