import * as fs from 'node:fs';
import * as path from 'node:path';

export interface MiyaSessionState {
  loopEnabled: boolean;
  autoContinue: boolean;
  maxIterationsPerWindow: number;

  iterationCompleted: number;
  windowStartIteration: number;
  awaitingConfirmation: boolean;
  strictQualityGate: boolean;

  lastDone: string[];
  lastMissing: string[];
  lastUnresolved: string[];

  autoContinueIteration: number;
  autoContinueAt: string;
  updatedAt: string;
}

interface MiyaLoopStateFile {
  sessions: Record<string, MiyaSessionState>;
}

const DEFAULT_STATE: MiyaSessionState = {
  loopEnabled: true,
  autoContinue: true,
  maxIterationsPerWindow: 3,

  iterationCompleted: 0,
  windowStartIteration: 0,
  awaitingConfirmation: false,
  strictQualityGate: true,
  lastDone: [],
  lastMissing: [],
  lastUnresolved: [],
  autoContinueIteration: -1,
  autoContinueAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function getMiyaRuntimeDir(projectDir: string): string {
  return path.join(projectDir, '.opencode', 'miya');
}

function getLoopStatePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'loop-state.json');
}

function readStateFile(filePath: string): MiyaLoopStateFile {
  if (!fs.existsSync(filePath)) {
    return { sessions: {} };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MiyaLoopStateFile>;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) {
      return { sessions: {} };
    }
    return { sessions: parsed.sessions };
  } catch {
    return { sessions: {} };
  }
}

function writeStateFile(filePath: string, state: MiyaLoopStateFile): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function getSessionState(
  projectDir: string,
  sessionID: string,
): MiyaSessionState {
  const filePath = getLoopStatePath(projectDir);
  const state = readStateFile(filePath);
  const current = state.sessions[sessionID];
  if (!current) {
    return { ...DEFAULT_STATE };
  }

  return {
    ...DEFAULT_STATE,
    ...current,
  };
}

export function setSessionState(
  projectDir: string,
  sessionID: string,
  sessionState: MiyaSessionState,
): void {
  const filePath = getLoopStatePath(projectDir);
  const state = readStateFile(filePath);
  state.sessions[sessionID] = {
    ...DEFAULT_STATE,
    ...sessionState,
    updatedAt: new Date().toISOString(),
  };
  writeStateFile(filePath, state);
}

export function resetSessionState(projectDir: string, sessionID: string): void {
  setSessionState(projectDir, sessionID, { ...DEFAULT_STATE });
}

export function isPositiveConfirmation(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  return (
    lowered === 'yes' ||
    lowered === 'y' ||
    lowered === 'continue' ||
    lowered === 'continue-work' ||
    lowered === '继续' ||
    lowered === '是'
  );
}

export function isNegativeConfirmation(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  return (
    lowered === 'no' ||
    lowered === 'n' ||
    lowered === 'stop' ||
    lowered === 'cancel' ||
    lowered === 'cancel-work' ||
    lowered === '停止' ||
    lowered === '取消' ||
    lowered === '否'
  );
}

export function shouldEnableStrictQualityGate(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes('strict-quality-gate') ||
    lowered.includes('strict quality gate') ||
    lowered.includes('deepwork')
  );
}
