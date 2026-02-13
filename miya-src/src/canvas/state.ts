import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface CanvasDocument {
  id: string;
  title: string;
  type: 'text' | 'markdown' | 'json' | 'html';
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasEvent {
  id: string;
  kind: 'open' | 'render' | 'close';
  docID: string;
  at: string;
  actor: string;
}

export interface CanvasState {
  activeDocID?: string;
  docs: Record<string, CanvasDocument>;
  events: CanvasEvent[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'canvas.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function defaultState(): CanvasState {
  return {
    activeDocID: undefined,
    docs: {},
    events: [],
  };
}

export function readCanvasState(projectDir: string): CanvasState {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<CanvasState>;
    return {
      activeDocID: parsed.activeDocID,
      docs: parsed.docs ?? {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return defaultState();
  }
}

export function writeCanvasState(projectDir: string, state: CanvasState): CanvasState {
  const file = filePath(projectDir);
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  return state;
}

function pushEvent(
  state: CanvasState,
  input: { kind: CanvasEvent['kind']; docID: string; actor: string },
): void {
  state.events = [
    {
      id: `canvas_evt_${randomUUID()}`,
      kind: input.kind,
      docID: input.docID,
      at: nowIso(),
      actor: input.actor,
    },
    ...state.events,
  ].slice(0, 400);
}

export function openCanvasDoc(
  projectDir: string,
  input: {
    title: string;
    type?: CanvasDocument['type'];
    content?: string;
    actor?: string;
  },
): CanvasDocument {
  const state = readCanvasState(projectDir);
  const id = `canvas_${randomUUID()}`;
  const now = nowIso();
  const doc: CanvasDocument = {
    id,
    title: input.title,
    type: input.type ?? 'markdown',
    content: input.content ?? '',
    createdAt: now,
    updatedAt: now,
  };
  state.docs[id] = doc;
  state.activeDocID = id;
  pushEvent(state, { kind: 'open', docID: id, actor: input.actor ?? 'gateway' });
  writeCanvasState(projectDir, state);
  return doc;
}

export function renderCanvasDoc(
  projectDir: string,
  input: {
    docID: string;
    content: string;
    merge?: boolean;
    actor?: string;
  },
): CanvasDocument | null {
  const state = readCanvasState(projectDir);
  const doc = state.docs[input.docID];
  if (!doc) return null;
  doc.content = input.merge ? `${doc.content}\n${input.content}` : input.content;
  doc.updatedAt = nowIso();
  state.activeDocID = doc.id;
  pushEvent(state, { kind: 'render', docID: doc.id, actor: input.actor ?? 'gateway' });
  writeCanvasState(projectDir, state);
  return doc;
}

export function closeCanvasDoc(
  projectDir: string,
  docID: string,
  actor = 'gateway',
): CanvasDocument | null {
  const state = readCanvasState(projectDir);
  const doc = state.docs[docID];
  if (!doc) return null;
  if (state.activeDocID === docID) {
    state.activeDocID = undefined;
  }
  pushEvent(state, { kind: 'close', docID, actor });
  writeCanvasState(projectDir, state);
  return doc;
}

export function listCanvasDocs(projectDir: string): CanvasDocument[] {
  const state = readCanvasState(projectDir);
  return Object.values(state.docs).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function getCanvasDoc(projectDir: string, docID: string): CanvasDocument | null {
  const state = readCanvasState(projectDir);
  return state.docs[docID] ?? null;
}
