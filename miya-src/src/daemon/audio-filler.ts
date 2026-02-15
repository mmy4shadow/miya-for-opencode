import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResourceTaskKind } from '../resource-scheduler';

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

export class AudioFillerController {
  constructor(private readonly projectDir: string) {}

  decide(input: { kind: ResourceTaskKind; timeoutMs?: number }): AudioFillerDecision {
    const expectedLatencyMs = estimateLatencyMs(input.kind, input.timeoutMs);
    if (expectedLatencyMs <= AUDIO_FILLER_THRESHOLD_MS) {
      return { shouldFill: false, expectedLatencyMs };
    }
    const clipPath = chooseRandom(listAudioCandidates(this.projectDir, input.kind));
    const text =
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

