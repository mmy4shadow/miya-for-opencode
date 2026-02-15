export type SentinelState = 'FOCUS' | 'CONSUME' | 'PLAY' | 'AWAY' | 'UNKNOWN';

export type SentinelForegroundCategory =
  | 'ide'
  | 'terminal'
  | 'browser'
  | 'player'
  | 'game'
  | 'chat'
  | 'other'
  | 'unknown';

export type ScreenProbeStatus = 'ok' | 'black' | 'error' | 'timeout' | 'not_run';

export interface SentinelSignals {
  idleSec?: number;
  foreground?: SentinelForegroundCategory;
  fullscreen?: boolean;
  audioActive?: boolean;
  gamepadActive?: boolean;
  windowSwitchPerMin?: number;
  screenProbe?: ScreenProbeStatus;
}

export interface SentinelInference {
  state: SentinelState;
  confidence: number;
  reasons: string[];
  shouldProbeScreen: boolean;
}

function asFinite(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function toConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, Number(raw.toFixed(2))));
}

export function inferSentinelState(input?: SentinelSignals): SentinelInference {
  const signals = input ?? {};
  const idleSec = asFinite(signals.idleSec);
  const foreground = signals.foreground ?? 'unknown';
  const fullscreen = Boolean(signals.fullscreen);
  const audioActive = Boolean(signals.audioActive);
  const gamepadActive = Boolean(signals.gamepadActive);
  const switchRate = asFinite(signals.windowSwitchPerMin) ?? 0;
  const screenProbe = signals.screenProbe ?? 'not_run';

  const reasons: string[] = [];
  let shouldProbeScreen = false;

  const probeFailed = screenProbe === 'black' || screenProbe === 'error' || screenProbe === 'timeout';
  if (probeFailed && (audioActive || fullscreen)) {
    reasons.push(`screen_probe_${screenProbe}`);
    reasons.push('probe_failed_with_media_signals');
    return {
      state: 'UNKNOWN',
      confidence: toConfidence(0.42),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (gamepadActive || foreground === 'game') {
    reasons.push(gamepadActive ? 'gamepad_active' : 'foreground_game');
    return {
      state: 'PLAY',
      confidence: toConfidence(gamepadActive ? 0.95 : 0.86),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (fullscreen && audioActive && (idleSec ?? 0) >= 45) {
    reasons.push('fullscreen_with_audio');
    return {
      state: 'CONSUME',
      confidence: toConfidence(0.88),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if ((foreground === 'ide' || foreground === 'terminal') && (idleSec ?? 0) < 180) {
    reasons.push(`foreground_${foreground}`);
    if (switchRate >= 8) {
      reasons.push('window_switch_high');
    }
    return {
      state: 'FOCUS',
      confidence: toConfidence(switchRate >= 8 ? 0.9 : 0.82),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (idleSec !== undefined && idleSec >= 300 && !audioActive && !fullscreen && !gamepadActive) {
    reasons.push('long_idle_without_media_or_gamepad');
    return {
      state: 'AWAY',
      confidence: toConfidence(0.84),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if ((idleSec ?? 0) >= 90 && (audioActive || fullscreen)) {
    shouldProbeScreen = true;
    reasons.push('idle_with_media_signal_needs_probe');
  }

  reasons.push(`foreground_${foreground}`);
  return {
    state: 'UNKNOWN',
    confidence: toConfidence(0.5),
    reasons,
    shouldProbeScreen,
  };
}
