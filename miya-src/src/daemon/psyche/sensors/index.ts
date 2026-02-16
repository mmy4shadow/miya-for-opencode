import type { SentinelSignals } from '../state-machine';
import { sampleAudioSignal } from './audio';
import { sampleForegroundSignal } from './foreground';
import { sampleGamepadSignal } from './gamepad';
import { sampleInputSignal } from './input';

export interface NativeSentinelSignalSample {
  sampledAt: string;
  signals: Partial<SentinelSignals>;
  captureLimitations: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function mergeCaptureLimitations(parts: string[][]): string[] {
  const merged = parts.flat().map((item) => String(item ?? '').trim()).filter(Boolean);
  return [...new Set(merged)].slice(0, 24);
}

export function collectNativeSentinelSignals(): NativeSentinelSignalSample {
  const input = sampleInputSignal();
  const foreground = sampleForegroundSignal();
  const audio = sampleAudioSignal();
  const gamepad = sampleGamepadSignal();

  return {
    sampledAt: nowIso(),
    signals: {
      ...input.signals,
      ...foreground.signals,
      ...audio.signals,
      ...gamepad.signals,
    },
    captureLimitations: mergeCaptureLimitations([
      input.limitations,
      foreground.limitations,
      audio.limitations,
      gamepad.limitations,
    ]),
  };
}

export { sampleInputSignal, sampleForegroundSignal, sampleAudioSignal, sampleGamepadSignal };
