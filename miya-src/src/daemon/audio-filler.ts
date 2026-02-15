import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResourceTaskKind } from '../resource-scheduler';
import { getMiyaRuntimeDir } from '../workflow';

export interface AudioFillerCue {
  cueID: string;
  kind: ResourceTaskKind;
  text: string;
  clipPath?: string;
  source: 'asset' | 'fallback';
  expectedLatencyMs: number;
  createdAt: string;
}

export interface AudioFillerDecision {
  shouldFill: boolean;
  expectedLatencyMs: number;
  cue?: AudioFillerCue;
}

const AUDIO_FILLER_THRESHOLD_MS = 500;
const RECENT_CUE_WINDOW = 3;

const FALLBACK_FILLERS: Record<ResourceTaskKind, string[]> = {
  'training.image': ['先帮你后台训练一下，我在盯进度。'],
  'training.voice': ['我先把声音训练流程跑起来，你稍等我汇报。'],
  'image.generate': ['好哒，我先找一个更合适的画面。'],
  'vision.analyze': ['我先看一下屏幕上的状态。'],
  'voice.tts': ['我在整理一下语气，很快就好。'],
  'voice.asr': ['我先把语音内容听清楚。'],
  'shell.exec': ['我先执行一下步骤，马上给你结果。'],
  generic: ['我在处理中，稍等我一下。'],
};

function nowIso(): string {
  return new Date().toISOString();
}

function estimateLatencyMs(kind: ResourceTaskKind, timeoutMs?: number): number {
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return Math.max(0, Math.floor(timeoutMs));
  }
  if (kind === 'training.image' || kind === 'training.voice') return 30_000;
  if (kind === 'image.generate') return 8_000;
  if (kind === 'voice.tts') return 3_000;
  if (kind === 'vision.analyze') return 1_200;
  if (kind === 'shell.exec') return 1_000;
  return 800;
}

function fillersDir(projectDir: string): string {
  return path.join(projectDir, 'miya-src', 'assets', 'audio_fillers');
}

interface AdaptiveWakeWord {
  path: string | undefined;
  text: string;
  weight: number;
  tags: string[];
}

function wakeWordsFileCandidates(projectDir: string): string[] {
  const runtimeDir = getMiyaRuntimeDir(projectDir);
  return [
    path.join(runtimeDir, 'model', 'sheng yin', 'cache', 'wake_words.json'),
    path.join(runtimeDir, 'model', 'sheng_yin', 'cache', 'wake_words.json'),
    path.join(runtimeDir, 'model', 'shengyin', 'cache', 'wake_words.json'),
  ];
}

function safeArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function parseAdaptiveWakeWords(projectDir: string): AdaptiveWakeWord[] {
  const file = wakeWordsFileCandidates(projectDir).find((candidate) => fs.existsSync(candidate));
  if (!file) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as
      | unknown[]
      | { items?: unknown[] };
    const rows = Array.isArray(raw)
      ? raw
      : safeArray((raw as { items?: unknown[] }).items);
    const baseDir = path.dirname(file);
    const parsed = rows
      .map((row) => {
        const text = typeof (row as { text?: unknown })?.text === 'string'
          ? (row as { text: string }).text.trim()
          : '';
        if (!text) return null;
        const weightRaw = Number((row as { weight?: unknown })?.weight ?? 1);
        const weight = Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : 1;
        const tags = safeArray((row as { tags?: unknown })?.tags)
          .map((item) => String(item).trim().toLowerCase())
          .filter(Boolean);
        const cuePathRaw =
          typeof (row as { path?: unknown })?.path === 'string'
            ? (row as { path: string }).path.trim()
            : '';
        let cuePath: string | undefined;
        if (cuePathRaw) {
          cuePath = path.isAbsolute(cuePathRaw) ? cuePathRaw : path.join(baseDir, cuePathRaw);
          if (!fs.existsSync(cuePath)) cuePath = undefined;
        }
        return {
          text,
          weight,
          tags,
          path: cuePath,
        } satisfies AdaptiveWakeWord;
      })
      .filter((item): item is AdaptiveWakeWord => Boolean(item));
    return parsed.slice(0, 500);
  } catch {
    return [];
  }
}

function tagsForKind(kind: ResourceTaskKind): string[] {
  switch (kind) {
    case 'training.image':
    case 'training.voice':
      return ['work', 'training'];
    case 'image.generate':
      return ['creative', 'image'];
    case 'vision.analyze':
      return ['analysis', 'vision'];
    case 'voice.tts':
    case 'voice.asr':
      return ['voice', 'chat'];
    case 'shell.exec':
      return ['work', 'coding'];
    default:
      return ['generic'];
  }
}

function listAudioCandidates(projectDir: string, kind: ResourceTaskKind): string[] {
  const root = fillersDir(projectDir);
  const candidates: string[] = [];
  const dirs = [path.join(root, kind), root];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/\.(wav|mp3|ogg)$/i.test(entry)) continue;
      candidates.push(path.join(dir, entry));
    }
  }
  return candidates;
}

function chooseRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  const idx = Math.floor(Math.random() * items.length);
  return items[idx];
}

function chooseWeighted<T extends { weight: number }>(
  items: T[],
  random: () => number,
): T | undefined {
  if (items.length === 0) return undefined;
  const total = items.reduce((sum, item) => sum + Math.max(0.0001, item.weight), 0);
  let cursor = random() * total;
  for (const item of items) {
    cursor -= Math.max(0.0001, item.weight);
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

export class AudioFillerController {
  private readonly random: () => number;
  private readonly recentCueTexts: string[] = [];

  constructor(
    private readonly projectDir: string,
    options?: {
      random?: () => number;
    },
  ) {
    this.random = options?.random ?? Math.random;
  }

  private pickAdaptiveCue(kind: ResourceTaskKind): AdaptiveWakeWord | undefined {
    const cues = parseAdaptiveWakeWords(this.projectDir);
    if (cues.length === 0) return undefined;
    const wantedTags = tagsForKind(kind);
    const matched = cues.filter(
      (item) => item.tags.length === 0 || item.tags.some((tag) => wantedTags.includes(tag)),
    );
    const pool = matched.length > 0 ? matched : cues;
    const notRecent = pool.filter((item) => !this.recentCueTexts.includes(item.text));
    const selected = chooseWeighted(notRecent.length > 0 ? notRecent : pool, this.random);
    if (!selected) return undefined;
    this.recentCueTexts.unshift(selected.text);
    if (this.recentCueTexts.length > RECENT_CUE_WINDOW) {
      this.recentCueTexts.splice(RECENT_CUE_WINDOW);
    }
    return selected;
  }

  decide(input: { kind: ResourceTaskKind; timeoutMs?: number }): AudioFillerDecision {
    const expectedLatencyMs = estimateLatencyMs(input.kind, input.timeoutMs);
    if (expectedLatencyMs <= AUDIO_FILLER_THRESHOLD_MS) {
      return { shouldFill: false, expectedLatencyMs };
    }
    const adaptiveCue = this.pickAdaptiveCue(input.kind);
    const clipPath =
      adaptiveCue?.path ??
      chooseRandom(listAudioCandidates(this.projectDir, input.kind));
    const text =
      adaptiveCue?.text ??
      chooseRandom(FALLBACK_FILLERS[input.kind] ?? FALLBACK_FILLERS.generic) ??
      FALLBACK_FILLERS.generic[0];
    return {
      shouldFill: true,
      expectedLatencyMs,
      cue: {
        cueID: `cue_${randomUUID()}`,
        kind: input.kind,
        text,
        clipPath,
        source: clipPath ? 'asset' : 'fallback',
        expectedLatencyMs,
        createdAt: nowIso(),
      },
    };
  }
}
