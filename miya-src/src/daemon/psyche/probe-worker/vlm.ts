import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProbeVlmResult } from './types';

interface LocalVlmRaw {
  sceneTags?: string[];
  confidence?: number;
  captureLimitations?: string[];
  redFlags?: string[];
  appHint?: string;
}

interface LocalVlmCommandSpec {
  command: string;
  args: string[];
  shell: boolean;
}

function parseCommandSpec(
  raw: string,
): { command: string; args: string[] } | null {
  const input = raw.trim();
  if (!input) return null;
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? '';
    if ((ch === '"' || ch === "'") && (!quote || quote === ch)) {
      quote = quote ? null : (ch as '"' | "'");
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  if (tokens.length === 0) return null;
  return { command: tokens[0] as string, args: tokens.slice(1) };
}

function parseLocalCommand(): LocalVlmCommandSpec | null {
  const dedicated = String(
    process.env.MIYA_SCREEN_PROBE_LOCAL_VLM_CMD ?? '',
  ).trim();
  if (dedicated) {
    const parsed = parseCommandSpec(dedicated);
    if (!parsed) return null;
    return { ...parsed, shell: false };
  }
  const shared = String(process.env.MIYA_VISION_LOCAL_CMD ?? '').trim();
  if (shared) {
    const parsed = parseCommandSpec(shared);
    if (parsed) return { ...parsed, shell: false };
    return { command: shared, args: [], shell: true };
  }

  const projectDir = process.cwd();
  const scriptPath = path.join(
    projectDir,
    'miya-src',
    'python',
    'infer_qwen3_vl.py',
  );
  if (!fs.existsSync(scriptPath)) return null;
  const backendCmd = String(process.env.MIYA_QWEN3VL_CMD ?? '').trim();
  const modelRoot =
    path.basename(projectDir).toLowerCase() === '.opencode'
      ? path.join(projectDir, 'miya', 'model')
      : path.join(projectDir, '.opencode', 'miya', 'model');
  const modelDir =
    String(process.env.MIYA_QWEN3VL_MODEL_DIR ?? '').trim() ||
    path.join(modelRoot, 'shi jue', 'Qwen3VL-4B-Instruct-Q4_K_M');
  const python =
    String(process.env.MIYA_VISION_PYTHON ?? '').trim() || 'python';
  const args = [scriptPath, '--mode', 'screen_probe', '--model-dir', modelDir];
  if (backendCmd) args.push('--backend-cmd', backendCmd);
  return {
    command: python,
    args,
    shell: false,
  };
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
  return [
    ...new Set(tags.map((item) => String(item ?? '').trim()).filter(Boolean)),
  ]
    .map((item) => item.toLowerCase())
    .slice(0, 12);
}

function inferSignalsFromTags(
  tags: string[],
  appHint?: string,
): ProbeVlmResult['inferredSignals'] {
  const normalizedHint = String(appHint ?? '')
    .trim()
    .toLowerCase();
  const inferred: ProbeVlmResult['inferredSignals'] = {};
  if (
    tags.some((item) => item.includes('playing_game') || item.includes('game'))
  ) {
    inferred.foreground = 'game';
    inferred.gamepadActive = true;
  } else if (
    tags.some(
      (item) =>
        item.includes('watching_video') ||
        item.includes('media') ||
        item.includes('player'),
    )
  ) {
    inferred.foreground = 'player';
    inferred.audioActive = true;
    inferred.fullscreen = true;
  } else if (
    tags.some((item) => item.includes('coding') || item.includes('terminal'))
  ) {
    inferred.foreground = normalizedHint.includes('terminal')
      ? 'terminal'
      : 'ide';
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
  const commandSpec = parseLocalCommand();
  if (!commandSpec) {
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
  const run = spawnSync(commandSpec.command, commandSpec.args, {
    input: payload,
    timeout: Math.max(600, input.timeoutMs),
    encoding: 'utf-8',
    shell: commandSpec.shell,
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
