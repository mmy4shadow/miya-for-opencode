import { captureFrameForScreenProbe } from './probe-worker/capture';
import { runScreenProbeVlm } from './probe-worker/vlm';
import type { SentinelSignals } from './state-machine';

export interface ScreenProbeResult {
  status: 'ok' | 'black' | 'error' | 'timeout';
  method?: 'dxgi_duplication' | 'wgc_hwnd' | 'print_window';
  captureLimitations: string[];
  sceneTags: string[];
  confidence: number;
  inferredSignals: Partial<SentinelSignals>;
}

export interface ScreenProbeInput {
  intent: string;
  channel?: string;
  timeoutMs?: number;
}

function uniqueStrings(values: string[]): string[] {
  return [
    ...new Set(values.map((item) => String(item ?? '').trim()).filter(Boolean)),
  ].slice(0, 24);
}

export function runScreenProbe(input: ScreenProbeInput): ScreenProbeResult {
  const timeoutMs = Math.max(
    800,
    Math.min(6_000, Math.floor(input.timeoutMs ?? 2_800)),
  );
  const capture = captureFrameForScreenProbe(timeoutMs);
  const captureLimitations = uniqueStrings(capture.limitations);
  if (!capture.ok) {
    const timedOut =
      capture.timedOut === true ||
      captureLimitations.includes('capture_probe_timeout');
    return {
      status: timedOut ? 'timeout' : 'error',
      method: capture.method,
      captureLimitations: uniqueStrings([
        ...captureLimitations,
        timedOut ? 'capture_probe_timeout' : 'capture_probe_error',
      ]),
      sceneTags: [],
      confidence: 0,
      inferredSignals: {},
    };
  }
  if (capture.blackFrame) {
    return {
      status: 'black',
      method: capture.method,
      captureLimitations: uniqueStrings([
        ...captureLimitations,
        'capture_probe_black_screen',
      ]),
      sceneTags: [],
      confidence: 0.25,
      inferredSignals: {},
    };
  }
  const imageBase64 = String(capture.imageBase64 ?? '').trim();
  if (!imageBase64) {
    return {
      status: 'error',
      method: capture.method,
      captureLimitations: uniqueStrings([
        ...captureLimitations,
        'capture_probe_error:no_frame_data',
      ]),
      sceneTags: [],
      confidence: 0,
      inferredSignals: {},
    };
  }

  const vlm = runScreenProbeVlm({
    imageBase64,
    question: `Analyze current desktop scene for intent=${input.intent}; output scene tags only.`,
    timeoutMs: timeoutMs - 300,
  });
  if (!vlm.ok) {
    return {
      status: 'ok',
      method: capture.method,
      captureLimitations: uniqueStrings([
        ...captureLimitations,
        ...vlm.limitations,
      ]),
      sceneTags: [],
      confidence: 0.4,
      inferredSignals: {},
    };
  }
  return {
    status: 'ok',
    method: capture.method,
    captureLimitations: uniqueStrings([
      ...captureLimitations,
      ...vlm.limitations,
    ]),
    sceneTags: vlm.sceneTags,
    confidence: vlm.confidence,
    inferredSignals: vlm.inferredSignals,
  };
}
