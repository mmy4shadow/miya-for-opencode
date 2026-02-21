import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface OcrCacheEntry {
  key: string;
  mediaID: string;
  question: string;
  boxes: OcrBoundingBox[];
  summary: string;
  createdAt: string;
  usedAt: string;
}

interface OcrCacheStore {
  entries: OcrCacheEntry[];
}

const MAX_CACHE_ITEMS = 500;

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'ocr-cache.json');
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(path.dirname(filePath(projectDir)), { recursive: true });
}

function readStore(projectDir: string): OcrCacheStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) return { entries: [] };
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<OcrCacheStore>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

function writeStore(projectDir: string, store: OcrCacheStore): void {
  ensureDir(projectDir);
  fs.writeFileSync(
    filePath(projectDir),
    `${JSON.stringify(store, null, 2)}\n`,
    'utf-8',
  );
}

function toKey(mediaID: string, question: string): string {
  return createHash('sha1')
    .update(`${mediaID}::${question.trim().toLowerCase()}`)
    .digest('hex');
}

export function readOcrCoordinateCache(
  projectDir: string,
  input: { mediaID: string; question?: string },
): OcrCacheEntry | null {
  const question = input.question?.trim() ?? '';
  const key = toKey(input.mediaID, question);
  const store = readStore(projectDir);
  const hit = store.entries.find((entry) => entry.key === key) ?? null;
  if (!hit) return null;
  hit.usedAt = nowIso();
  writeStore(projectDir, store);
  return hit;
}

export function writeOcrCoordinateCache(
  projectDir: string,
  input: {
    mediaID: string;
    question?: string;
    boxes: OcrBoundingBox[];
    summary: string;
  },
): void {
  const question = input.question?.trim() ?? '';
  const key = toKey(input.mediaID, question);
  const store = readStore(projectDir);
  const next: OcrCacheEntry = {
    key,
    mediaID: input.mediaID,
    question,
    boxes: input.boxes,
    summary: input.summary,
    createdAt: nowIso(),
    usedAt: nowIso(),
  };
  const deduped = store.entries.filter((entry) => entry.key !== key);
  store.entries = [next, ...deduped]
    .sort((a, b) => Date.parse(b.usedAt) - Date.parse(a.usedAt))
    .slice(0, MAX_CACHE_ITEMS);
  writeStore(projectDir, store);
}
