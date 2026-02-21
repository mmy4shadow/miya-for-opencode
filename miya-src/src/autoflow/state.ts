import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type {
  AutoflowFixStep,
  AutoflowHistoryRecord,
  AutoflowPhase,
  AutoflowSessionState,
  AutoflowStateFile,
} from './types';

const DEFAULT_MAX_FIX_ROUNDS = 3;
const MAX_HISTORY = 120;

function nowIso(): string {
  return new Date().toISOString();
}

function stateFilePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'autoflow-state.json');
}

function ensureRuntimeDir(projectDir: string): void {
  fs.mkdirSync(path.dirname(stateFilePath(projectDir)), { recursive: true });
}

function normalizeFixRounds(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_FIX_ROUNDS;
  return Math.max(1, Math.min(10, Math.floor(Number(value))));
}

function normalizeState(
  sessionID: string,
  raw?: Partial<AutoflowSessionState>,
): AutoflowSessionState {
  const createdAt = raw?.createdAt ?? nowIso();
  const history = Array.isArray(raw?.history)
    ? raw?.history.slice(-MAX_HISTORY).map((item) => ({
        at: String(item.at ?? createdAt),
        phase: (item.phase ?? 'planning') as AutoflowPhase,
        event: String(item.event ?? 'unknown'),
        summary: String(item.summary ?? ''),
      }))
    : [];

  const fixCommands = Array.isArray(raw?.fixCommands)
    ? raw.fixCommands
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const fixSteps: AutoflowFixStep[] = [];
  if (Array.isArray(raw?.fixSteps)) {
    raw.fixSteps.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const row = item as Partial<AutoflowFixStep>;
      if (row.type === 'command') {
        const command = String(
          (row as { command?: unknown }).command ?? '',
        ).trim();
        if (!command) return;
        fixSteps.push({
          id: String(
            row.id ?? `fix_command_${Math.random().toString(36).slice(2, 8)}`,
          ),
          type: 'command',
          command,
          description:
            typeof row.description === 'string'
              ? row.description.trim()
              : undefined,
        });
        return;
      }
      if (row.type === 'agent_task') {
        const agent = String((row as { agent?: unknown }).agent ?? '').trim();
        const prompt = String(
          (row as { prompt?: unknown }).prompt ?? '',
        ).trim();
        const description = String(
          (row as { description?: unknown }).description ?? '',
        ).trim();
        if (!agent || !prompt || !description) return;
        fixSteps.push({
          id: String(
            row.id ?? `fix_agent_${Math.random().toString(36).slice(2, 8)}`,
          ),
          type: 'agent_task',
          agent,
          prompt,
          description,
          timeoutMs:
            typeof (row as { timeoutMs?: unknown }).timeoutMs === 'number'
              ? Number((row as { timeoutMs?: number }).timeoutMs)
              : undefined,
          maxRetries:
            typeof (row as { maxRetries?: unknown }).maxRetries === 'number'
              ? Number((row as { maxRetries?: number }).maxRetries)
              : undefined,
        });
      }
    });
  }
  const recentVerificationHashes = Array.isArray(raw?.recentVerificationHashes)
    ? raw.recentVerificationHashes.map(String).slice(-3)
    : [];
  const planTasks = Array.isArray(raw?.planTasks) ? raw.planTasks : [];

  return {
    sessionID,
    goal: String(raw?.goal ?? '').trim(),
    phase: (raw?.phase ?? 'planning') as AutoflowPhase,
    createdAt,
    updatedAt: raw?.updatedAt ?? createdAt,
    maxFixRounds: normalizeFixRounds(raw?.maxFixRounds),
    fixRound: Number.isFinite(raw?.fixRound)
      ? Math.max(0, Math.floor(Number(raw?.fixRound)))
      : 0,
    verificationCommand: raw?.verificationCommand
      ? String(raw.verificationCommand)
      : undefined,
    fixCommands,
    fixSteps,
    planTasks,
    recentVerificationHashes,
    lastError: raw?.lastError ? String(raw.lastError) : undefined,
    lastDag:
      raw?.lastDag && Number.isFinite(raw.lastDag.total)
        ? {
            total: Math.max(0, Math.floor(Number(raw.lastDag.total))),
            completed: Math.max(0, Math.floor(Number(raw.lastDag.completed))),
            failed: Math.max(0, Math.floor(Number(raw.lastDag.failed))),
            blocked: Math.max(0, Math.floor(Number(raw.lastDag.blocked))),
          }
        : undefined,
    history,
  };
}

function readStore(projectDir: string): AutoflowStateFile {
  const file = stateFilePath(projectDir);
  if (!fs.existsSync(file)) return { sessions: {} };
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<AutoflowStateFile>;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) {
      return { sessions: {} };
    }
    const sessions: Record<string, AutoflowSessionState> = {};
    for (const [sessionID, state] of Object.entries(parsed.sessions)) {
      sessions[sessionID] = normalizeState(
        sessionID,
        state as Partial<AutoflowSessionState>,
      );
    }
    return { sessions };
  } catch {
    return { sessions: {} };
  }
}

function writeStore(projectDir: string, store: AutoflowStateFile): void {
  ensureRuntimeDir(projectDir);
  fs.writeFileSync(
    stateFilePath(projectDir),
    `${JSON.stringify(store, null, 2)}\n`,
    'utf-8',
  );
}

export function loadAutoflowSession(
  projectDir: string,
  sessionID: string,
): AutoflowSessionState | null {
  const store = readStore(projectDir);
  return store.sessions[sessionID] ?? null;
}

export function listAutoflowSessions(
  projectDir: string,
  limit = 50,
): AutoflowSessionState[] {
  const store = readStore(projectDir);
  return Object.values(store.sessions)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export function getAutoflowSession(
  projectDir: string,
  sessionID: string,
): AutoflowSessionState {
  return (
    loadAutoflowSession(projectDir, sessionID) ?? normalizeState(sessionID)
  );
}

export function saveAutoflowSession(
  projectDir: string,
  session: AutoflowSessionState,
): AutoflowSessionState {
  const store = readStore(projectDir);
  const normalized = normalizeState(session.sessionID, {
    ...session,
    updatedAt: nowIso(),
  });
  store.sessions[session.sessionID] = normalized;
  writeStore(projectDir, store);
  return normalized;
}

export function appendAutoflowHistory(
  session: AutoflowSessionState,
  event: string,
  summary: string,
): AutoflowSessionState {
  const record: AutoflowHistoryRecord = {
    at: nowIso(),
    phase: session.phase,
    event,
    summary,
  };
  session.history = [...session.history, record].slice(-MAX_HISTORY);
  return session;
}

export function configureAutoflowSession(
  projectDir: string,
  input: {
    sessionID: string;
    goal?: string;
    tasks?: AutoflowSessionState['planTasks'];
    verificationCommand?: string;
    fixCommands?: string[];
    fixSteps?: AutoflowFixStep[];
    maxFixRounds?: number;
    phase?: AutoflowPhase;
  },
): AutoflowSessionState {
  const current = getAutoflowSession(projectDir, input.sessionID);
  const next: AutoflowSessionState = {
    ...current,
    goal: typeof input.goal === 'string' ? input.goal.trim() : current.goal,
    planTasks:
      Array.isArray(input.tasks) && input.tasks.length > 0
        ? input.tasks
        : current.planTasks,
    verificationCommand:
      typeof input.verificationCommand === 'string'
        ? input.verificationCommand.trim() || undefined
        : current.verificationCommand,
    fixCommands: Array.isArray(input.fixCommands)
      ? input.fixCommands
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : current.fixCommands,
    fixSteps: Array.isArray(input.fixSteps) ? input.fixSteps : current.fixSteps,
    maxFixRounds:
      typeof input.maxFixRounds === 'number'
        ? normalizeFixRounds(input.maxFixRounds)
        : current.maxFixRounds,
    phase: input.phase ?? current.phase,
  };
  if (next.phase === 'planning') {
    next.fixRound = 0;
    next.recentVerificationHashes = [];
    next.lastError = undefined;
  }
  return saveAutoflowSession(projectDir, next);
}

export function stopAutoflowSession(
  projectDir: string,
  sessionID: string,
): AutoflowSessionState {
  const current = getAutoflowSession(projectDir, sessionID);
  current.phase = 'stopped';
  appendAutoflowHistory(current, 'stopped', 'Session stopped by operator.');
  return saveAutoflowSession(projectDir, current);
}
