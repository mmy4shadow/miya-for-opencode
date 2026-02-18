import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { IntakeState } from './types';

const DEFAULT_STATE: IntakeState = {
  proposals: [],
  whitelist: [],
  blacklist: [],
  events: [],
};

const MAX_PROPOSALS = 1000;
const MAX_LIST_ENTRIES = 1000;
const MAX_EVENTS = 5000;

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'intake.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function randomId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${time}_${rand}`;
}

function sanitizeState(input: unknown): IntakeState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_STATE };
  }
  const parsed = input as Partial<IntakeState>;
  return {
    proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist : [],
    blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

export function createIntakeId(prefix: string): string {
  return randomId(prefix);
}

export function readIntakeState(projectDir: string): IntakeState {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return { ...DEFAULT_STATE };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    return sanitizeState(parsed);
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeIntakeState(projectDir: string, state: IntakeState): void {
  const file = filePath(projectDir);
  ensureDir(file);
  const normalized: IntakeState = {
    proposals: state.proposals.slice(0, MAX_PROPOSALS),
    whitelist: state.whitelist.slice(0, MAX_LIST_ENTRIES),
    blacklist: state.blacklist.slice(0, MAX_LIST_ENTRIES),
    events: state.events.slice(0, MAX_EVENTS),
  };
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
}
