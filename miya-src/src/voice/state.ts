import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface VoiceHistoryItem {
  id: string;
  text: string;
  source: 'wake' | 'talk' | 'manual' | 'media';
  language?: string;
  mediaID?: string;
  createdAt: string;
}

export interface VoiceState {
  enabled: boolean;
  wakeWordEnabled: boolean;
  talkMode: boolean;
  routeSessionID: string;
  sttProvider: 'local' | 'off';
  ttsProvider: 'local' | 'off';
  lastInputAt?: string;
  lastTranscript?: string;
  history: VoiceHistoryItem[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'voice.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function defaultState(): VoiceState {
  return {
    enabled: false,
    wakeWordEnabled: false,
    talkMode: false,
    routeSessionID: 'main',
    sttProvider: 'local',
    ttsProvider: 'local',
    history: [],
  };
}

export function readVoiceState(projectDir: string): VoiceState {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return defaultState();
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<VoiceState>;
    return {
      ...defaultState(),
      ...parsed,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return defaultState();
  }
}

export function writeVoiceState(
  projectDir: string,
  state: VoiceState,
): VoiceState {
  const file = filePath(projectDir);
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  return state;
}

export function patchVoiceState(
  projectDir: string,
  patch: Partial<Omit<VoiceState, 'history'>>,
): VoiceState {
  const current = readVoiceState(projectDir);
  const next: VoiceState = {
    ...current,
    ...patch,
  };
  return writeVoiceState(projectDir, next);
}

export function appendVoiceHistory(
  projectDir: string,
  input: {
    text: string;
    source: VoiceHistoryItem['source'];
    language?: string;
    mediaID?: string;
  },
): VoiceHistoryItem {
  const state = readVoiceState(projectDir);
  const item: VoiceHistoryItem = {
    id: `voice_${randomUUID()}`,
    text: input.text,
    source: input.source,
    language: input.language,
    mediaID: input.mediaID,
    createdAt: nowIso(),
  };
  const next: VoiceState = {
    ...state,
    lastInputAt: item.createdAt,
    lastTranscript: item.text,
    history: [item, ...state.history].slice(0, 200),
  };
  writeVoiceState(projectDir, next);
  return item;
}

export function clearVoiceHistory(projectDir: string): VoiceState {
  const state = readVoiceState(projectDir);
  return writeVoiceState(projectDir, {
    ...state,
    history: [],
    lastInputAt: undefined,
    lastTranscript: undefined,
  });
}
