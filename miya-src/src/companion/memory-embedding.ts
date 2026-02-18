import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

export type EmbeddingProviderKind =
  | 'local-hash'
  | 'local-ngram'
  | 'remote-http';

export interface EmbeddingProviderConfig {
  kind: EmbeddingProviderKind;
  dims: number;
  url?: string;
  model?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fallbackKind?: 'local-hash' | 'local-ngram';
}

export interface EmbeddingProviderInfo {
  kind: EmbeddingProviderKind;
  description: string;
  supportsRemote: boolean;
}

const DEFAULT_CONFIG: EmbeddingProviderConfig = {
  kind: 'local-hash',
  dims: 64,
  timeoutMs: 2_500,
  fallbackKind: 'local-hash',
};

const PROVIDERS: EmbeddingProviderInfo[] = [
  {
    kind: 'local-hash',
    description: 'Deterministic hash embedding, low-cost and offline.',
    supportsRemote: false,
  },
  {
    kind: 'local-ngram',
    description: 'Character ngram hashing optimized for mixed CJK/English.',
    supportsRemote: false,
  },
  {
    kind: 'remote-http',
    description: 'HTTP embedding endpoint with local fallback.',
    supportsRemote: true,
  },
];

function configPath(projectDir: string): string {
  return path.join(
    getMiyaRuntimeDir(projectDir),
    'memory',
    'embedding-provider.json',
  );
}

function ensureDir(projectDir: string): void {
  fs.mkdirSync(path.dirname(configPath(projectDir)), { recursive: true });
}

function normalizeText(text: string): string {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function toNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(next)));
}

function normalizeHeaders(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const k = String(key).trim();
    const v = String(value ?? '').trim();
    if (!k || !v) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeConfig(
  raw: Partial<EmbeddingProviderConfig> | undefined,
): EmbeddingProviderConfig {
  const kind: EmbeddingProviderKind =
    raw?.kind === 'local-hash' ||
    raw?.kind === 'local-ngram' ||
    raw?.kind === 'remote-http'
      ? raw.kind
      : DEFAULT_CONFIG.kind;
  const fallbackKind: 'local-hash' | 'local-ngram' =
    raw?.fallbackKind === 'local-ngram' ? 'local-ngram' : 'local-hash';
  return {
    kind,
    dims: toNumber(raw?.dims, DEFAULT_CONFIG.dims, 16, 2048),
    url: typeof raw?.url === 'string' ? raw.url.trim() || undefined : undefined,
    model:
      typeof raw?.model === 'string'
        ? raw.model.trim() || undefined
        : undefined,
    timeoutMs: toNumber(
      raw?.timeoutMs,
      DEFAULT_CONFIG.timeoutMs ?? 2_500,
      500,
      20_000,
    ),
    headers: normalizeHeaders(raw?.headers),
    fallbackKind,
  };
}

export function listEmbeddingProviders(): EmbeddingProviderInfo[] {
  return PROVIDERS;
}

export function readEmbeddingProviderConfig(
  projectDir: string,
): EmbeddingProviderConfig {
  const file = configPath(projectDir);
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<EmbeddingProviderConfig>;
    return normalizeConfig(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeEmbeddingProviderConfig(
  projectDir: string,
  patch: Partial<EmbeddingProviderConfig>,
): EmbeddingProviderConfig {
  const current = readEmbeddingProviderConfig(projectDir);
  const next = normalizeConfig({
    ...current,
    ...patch,
    headers: patch.headers ?? current.headers,
  });
  ensureDir(projectDir);
  fs.writeFileSync(
    configPath(projectDir),
    `${JSON.stringify(next, null, 2)}\n`,
    'utf-8',
  );
  return next;
}

function baseTokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function localHashEmbedding(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  const parts = baseTokenize(text);
  if (parts.length === 0) return vec;
  for (const part of parts) {
    const hash = createHash('sha256').update(part).digest();
    for (let i = 0; i < 8; i += 1) {
      const idx = hash[i] % dims;
      vec[idx] += 1 + (hash[i + 8] % 3);
    }
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (norm <= 0) return vec;
  return vec.map((value) => value / norm);
}

function charNgrams(input: string): string[] {
  const text = normalizeText(input).toLowerCase();
  if (text.length < 2) return text ? [text] : [];
  const chars = Array.from(text.replace(/\s+/g, ''));
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    out.push(chars.slice(i, i + 2).join(''));
    if (i + 3 <= chars.length) out.push(chars.slice(i, i + 3).join(''));
  }
  return out.filter((item) => item.length >= 2);
}

function localNgramEmbedding(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  const grams = charNgrams(text);
  if (grams.length === 0) return localHashEmbedding(text, dims);
  for (const gram of grams) {
    const hash = createHash('sha256').update(gram).digest();
    const idxA = hash[0] % dims;
    const idxB = hash[1] % dims;
    vec[idxA] += 1.2;
    vec[idxB] += 0.8;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (norm <= 0) return vec;
  return vec.map((value) => value / norm);
}

function fallbackEmbedding(
  text: string,
  dims: number,
  fallbackKind: 'local-hash' | 'local-ngram',
): number[] {
  return fallbackKind === 'local-ngram'
    ? localNgramEmbedding(text, dims)
    : localHashEmbedding(text, dims);
}

function extractEmbeddingPayload(raw: unknown): number[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const direct = obj.embedding;
  if (Array.isArray(direct)) {
    return direct
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  }
  if (Array.isArray(obj.data) && obj.data.length > 0) {
    const first = obj.data[0] as Record<string, unknown>;
    if (first && Array.isArray(first.embedding)) {
      return first.embedding
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    }
  }
  return null;
}

function remoteHttpEmbedding(
  text: string,
  config: EmbeddingProviderConfig,
): number[] | null {
  if (!config.url || typeof Bun === 'undefined') return null;
  try {
    const args: string[] = [
      '-sS',
      '--max-time',
      String(Math.ceil((config.timeoutMs ?? 2500) / 1000)),
      '-H',
      'Content-Type: application/json',
    ];
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        args.push('-H', `${key}: ${value}`);
      }
    }
    const payload = {
      input: [text],
      model: config.model,
      dimensions: config.dims,
    };
    args.push('-X', 'POST', '--data', JSON.stringify(payload), config.url);
    const proc = Bun.spawnSync(['curl', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: config.timeoutMs,
    });
    if (proc.exitCode !== 0) return null;
    const body = Buffer.from(proc.stdout).toString('utf-8').trim();
    if (!body) return null;
    const parsed = JSON.parse(body) as unknown;
    const values = extractEmbeddingPayload(parsed);
    if (!values || values.length === 0) return null;
    const dims = Math.max(8, config.dims);
    if (values.length === dims) return values;
    if (values.length > dims) return values.slice(0, dims);
    return [...values, ...new Array<number>(dims - values.length).fill(0)];
  } catch {
    return null;
  }
}

export function embedTextWithProvider(
  projectDir: string,
  text: string,
): { embedding: number[]; provider: string; dims: number } {
  const config = readEmbeddingProviderConfig(projectDir);
  const dims = Math.max(16, config.dims);
  if (config.kind === 'local-hash') {
    return {
      embedding: localHashEmbedding(text, dims),
      provider: 'local-hash',
      dims,
    };
  }
  if (config.kind === 'local-ngram') {
    return {
      embedding: localNgramEmbedding(text, dims),
      provider: 'local-ngram',
      dims,
    };
  }
  const remote = remoteHttpEmbedding(text, config);
  if (remote && remote.length > 0) {
    return {
      embedding: remote,
      provider: `remote-http:${config.model ?? 'default'}`,
      dims,
    };
  }
  const fallbackKind = config.fallbackKind ?? 'local-hash';
  return {
    embedding: fallbackEmbedding(text, dims, fallbackKind),
    provider: `remote-http:fallback:${fallbackKind}`,
    dims,
  };
}
