import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../security/system-keyring';
import { getMiyaRuntimeDir } from '../workflow';

export interface MediaItem {
  id: string;
  source: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;
  fileName: string;
  localPath?: string;
  sizeBytes?: number;
  createdAt: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

interface MediaStore {
  items: Record<string, MediaItem>;
}

const DEFAULT_TTL_HOURS = 24;

function nowIso(): string {
  return new Date().toISOString();
}

function mediaDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'media');
}

function mediaIndexFile(projectDir: string): string {
  return path.join(mediaDir(projectDir), 'index.json');
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function decodeMetadata(
  projectDir: string,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object') return metadata;
  if (typeof metadata.secure === 'string') {
    try {
      const plain = decryptSensitiveValue(projectDir, metadata.secure);
      const parsed = JSON.parse(plain) as Record<string, unknown>;
      return parsed;
    } catch {
      return metadata;
    }
  }
  return metadata;
}

function readStore(projectDir: string): MediaStore {
  const file = mediaIndexFile(projectDir);
  if (!fs.existsSync(file)) {
    return { items: {} };
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<MediaStore>;
    const items: Record<string, MediaItem> = {};
    for (const [id, item] of Object.entries(parsed.items ?? {})) {
      items[id] = {
        ...item,
        source: decryptSensitiveValue(projectDir, String(item.source ?? '')),
        fileName: decryptSensitiveValue(
          projectDir,
          String(item.fileName ?? ''),
        ),
        localPath:
          typeof item.localPath === 'string'
            ? decryptSensitiveValue(projectDir, item.localPath)
            : item.localPath,
        metadata: decodeMetadata(projectDir, item.metadata),
      } as MediaItem;
    }
    return { items };
  } catch {
    return { items: {} };
  }
}

function writeStore(projectDir: string, store: MediaStore): void {
  ensureDir(mediaDir(projectDir));
  const encrypted: MediaStore = { items: {} };
  for (const [id, item] of Object.entries(store.items)) {
    encrypted.items[id] = {
      ...item,
      source: encryptSensitiveValue(projectDir, item.source),
      fileName: encryptSensitiveValue(projectDir, item.fileName),
      localPath: item.localPath
        ? encryptSensitiveValue(projectDir, item.localPath)
        : item.localPath,
      metadata: item.metadata
        ? {
            secure: encryptSensitiveValue(
              projectDir,
              JSON.stringify(item.metadata),
            ),
          }
        : item.metadata,
    };
  }
  fs.writeFileSync(
    mediaIndexFile(projectDir),
    `${JSON.stringify(encrypted, null, 2)}\n`,
    'utf-8',
  );
}

function buildExpiration(ttlHours: number): string {
  const expires = new Date(Date.now() + ttlHours * 3600 * 1000);
  return expires.toISOString();
}

export function ingestMedia(
  projectDir: string,
  input: {
    source: string;
    kind: MediaItem['kind'];
    mimeType: string;
    fileName: string;
    contentBase64?: string;
    sizeBytes?: number;
    ttlHours?: number;
    metadata?: Record<string, unknown>;
  },
): MediaItem {
  const ttlHours = Math.max(1, input.ttlHours ?? DEFAULT_TTL_HOURS);
  const store = readStore(projectDir);
  const id = `media_${randomUUID()}`;
  let localPath: string | undefined;

  if (input.contentBase64) {
    const dir = mediaDir(projectDir);
    ensureDir(dir);
    const ext = path.extname(input.fileName) || '.bin';
    const filePath = path.join(dir, `${id}${ext}`);
    fs.writeFileSync(filePath, Buffer.from(input.contentBase64, 'base64'));
    localPath = filePath;
  }

  const item: MediaItem = {
    id,
    source: input.source,
    kind: input.kind,
    mimeType: input.mimeType,
    fileName: input.fileName,
    localPath,
    sizeBytes: input.sizeBytes,
    createdAt: nowIso(),
    expiresAt: buildExpiration(ttlHours),
    metadata: input.metadata,
  };
  store.items[id] = item;
  writeStore(projectDir, store);
  return item;
}

export function getMediaItem(
  projectDir: string,
  mediaID: string,
): MediaItem | null {
  const store = readStore(projectDir);
  return store.items[mediaID] ?? null;
}

export function listMediaItems(projectDir: string, limit = 100): MediaItem[] {
  const store = readStore(projectDir);
  return Object.values(store.items)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, limit));
}

export function runMediaGc(projectDir: string): {
  removed: number;
  kept: number;
} {
  const store = readStore(projectDir);
  const now = Date.now();
  let removed = 0;

  for (const [id, item] of Object.entries(store.items)) {
    const expired = Date.parse(item.expiresAt) <= now;
    if (!expired) continue;

    if (item.localPath && fs.existsSync(item.localPath)) {
      try {
        fs.unlinkSync(item.localPath);
      } catch {
        // Best effort cleanup.
      }
    }

    delete store.items[id];
    removed += 1;
  }

  writeStore(projectDir, store);
  return {
    removed,
    kept: Object.keys(store.items).length,
  };
}
