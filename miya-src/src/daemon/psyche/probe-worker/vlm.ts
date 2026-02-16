import { spawnSync } from 'node:child_process';
import type { ProbeVlmResult } from './types';

interface LocalVlmRaw {
  sceneTags?: string[];
  confidence?: number;
  captureLimitations?: string[];
  redFlags?: string[];
  appHint?: string;
}

function parseLocalCommand(): string {
  const dedicated = String(process.env.MIYA_SCREEN_PROBE_LOCAL_VLM_CMD ?? '').trim();
  if (dedicated) return dedicated;
  return String(process.env.MIYA_VISION_LOCAL_CMD ?? '').trim();
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((item) => String(item ?? '').trim()).filter(Boolean))]
    .map((item) => item.toLowerCase())
    .slice(0, 12);
}

function inferSignalsFromTags(tags: string[], appHint?: string): ProbeVlmResult['inferredSignals'] {
  const normalizedHint = String(appHint ?? '').trim().toLowerCase();
  const inferred: ProbeVlmResult['inferredSignals'] = {};
  if (tags.some((item) => item.includes('playing_game') || item.includes('game'))) {
    inferred.foreground = 'game';
    inferred.gamepadActive = true;
  } else if (
    tags.some((item) => item.includes('watching_video') || item.includes('media') || item.includes('player'))
  ) {
    inferred.foreground = 'player';
    inferred.audioActive = true;
    inferred.fullscreen = true;
  } else if (tags.some((item) => item.includes('coding') || item.includes('terminal'))) {
    inferred.foreground = normalizedHint.includes('terminal') ? 'terminal' : 'ide';
  }
  if (normalizedHint.includes('player')) inferred.foreground = 'player';
  if (normalizedHint.includes('game')) inferred.foreground = 'game';
  return inferred;
}

export function runScreenProbeVlm(input: {
  imageBase64: string;
  question: string;
  timeoutMs: number;
}): ProbeVlmResult {
  const command = parseLocalCommand();
  if (!command) {
    return {
      ok: false,
      sceneTags: [],
      confidence: 0,
      limitations: ['local_vlm_command_missing'],
      inferredSignals: {},
      error: 'local_vlm_command_missing',
    };
  }
  const payload = JSON.stringify({
    imageBase64: input.imageBase64,
    question: input.question,
    mode: 'screen_probe',
  });
  const run = spawnSync(command, [], {
    input: payload,
    timeout: Math.max(600, input.timeoutMs),
    encoding: 'utf-8',
    shell: true,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (run.error) {
    return {
      ok: false,
      sceneTags: [],
      confidence: 0,
      limitations: ['local_vlm_exec_failed'],
      inferredSignals: {},
      error: run.error.message || 'local_vlm_exec_failed',
    };
  }
  if (run.signal) {
    return {
      ok: false,
      sceneTags: [],
      confidence: 0,
      limitations: ['local_vlm_timeout'],
      inferredSignals: {},
      error: String(run.signal),
    };
  }
  if (run.status !== 0) {
    return {
      ok: false,
      sceneTags: [],
      confidence: 0,
      limitations: ['local_vlm_nonzero_exit'],
      inferredSignals: {},
      error: String(run.stderr ?? `exit_${run.status}`).trim(),
    };
  }
  const parsed = parseJson<LocalVlmRaw>(String(run.stdout ?? '').trim());
  if (!parsed) {
    return {
      ok: false,
      sceneTags: [],
      confidence: 0,
      limitations: ['local_vlm_invalid_json'],
      inferredSignals: {},
      error: 'local_vlm_invalid_json',
    };
  }
  const sceneTags = normalizeTags(parsed.sceneTags);
  const confidenceRaw = Number(parsed.confidence ?? Number.NaN);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, Number(confidenceRaw.toFixed(3))))
    : sceneTags.length > 0
      ? 0.6
      : 0.35;
  const limitations = [
    ...normalizeTags(parsed.captureLimitations),
    ...normalizeTags(parsed.redFlags).map((item) => `red_flag:${item}`),
  ];
  return {
    ok: true,
    sceneTags,
    confidence,
    limitations,
    inferredSignals: inferSignalsFromTags(sceneTags, parsed.appHint),
  };
}
