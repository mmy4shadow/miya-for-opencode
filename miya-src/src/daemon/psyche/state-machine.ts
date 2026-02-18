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

export type ScreenProbeStatus =
  | 'ok'
  | 'black'
  | 'error'
  | 'timeout'
  | 'not_run';

export interface SentinelSignals {
  idleSec?: number;
  foreground?: SentinelForegroundCategory;
  foregroundTitle?: string;
  fullscreen?: boolean;
  audioActive?: boolean;
  audioSessionActive?: boolean;
  audioSessionCount?: number;
  gamepadActive?: boolean;
  xinputActive?: boolean;
  rawInputActive?: boolean;
  apm?: number;
  windowSwitchPerMin?: number;
  timeInStateSec?: number;
  focusStreakSec?: number;
  stateTransition?: string;
  captureLimitations?: string[];
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

function hasKeyword(text: string, keywords: readonly string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function inferSentinelState(input?: SentinelSignals): SentinelInference {
  const signals = input ?? {};
  const idleSec = asFinite(signals.idleSec);
  const foreground = signals.foreground ?? 'unknown';
  const foregroundTitle = String(signals.foregroundTitle ?? '')
    .trim()
    .toLowerCase();
  const fullscreen = Boolean(signals.fullscreen);
  const audioSessionCount = asFinite(signals.audioSessionCount) ?? 0;
  const audioActive = Boolean(
    signals.audioActive || signals.audioSessionActive || audioSessionCount > 0,
  );
  const gamepadActive = Boolean(signals.gamepadActive || signals.xinputActive);
  const rawInputActive = Boolean(signals.rawInputActive);
  const switchRate = asFinite(signals.windowSwitchPerMin) ?? 0;
  const apm = asFinite(signals.apm) ?? 0;
  const captureLimitations = Array.isArray(signals.captureLimitations)
    ? signals.captureLimitations
        .map((item) =>
          String(item || '')
            .trim()
            .toLowerCase(),
        )
        .filter((item) => item.length > 0)
    : [];
  const screenProbe = signals.screenProbe ?? 'not_run';

  const reasons: string[] = [];
  let shouldProbeScreen = false;
  const looksLikeProtectedCapture = captureLimitations.some((item) =>
    ['drm', 'hdcp', 'protected', 'pmp', 'copyright'].some((flag) =>
      item.includes(flag),
    ),
  );
  const inputSignalConflict =
    ((idleSec ?? 0) >= 120 && (rawInputActive || switchRate >= 10)) ||
    ((foreground === 'game' || foreground === 'player') &&
      !audioActive &&
      (idleSec ?? 0) >= 120 &&
      switchRate >= 8);

  const probeFailed =
    screenProbe === 'black' ||
    screenProbe === 'error' ||
    screenProbe === 'timeout';
  if (probeFailed) {
    reasons.push(`screen_probe_${screenProbe}`);
    if (looksLikeProtectedCapture || screenProbe === 'black') {
      reasons.push('screen_probe_capture_protected');
    }
    reasons.push(
      audioActive || fullscreen
        ? 'probe_failed_with_media_signals'
        : 'probe_failed_fallback_unknown',
    );
    return {
      state: 'UNKNOWN',
      confidence: toConfidence(audioActive || fullscreen ? 0.46 : 0.41),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (inputSignalConflict) {
    shouldProbeScreen =
      fullscreen ||
      audioActive ||
      foreground === 'game' ||
      foreground === 'player';
    reasons.push('input_signal_conflict');
    return {
      state: 'UNKNOWN',
      confidence: toConfidence(0.44),
      reasons,
      shouldProbeScreen,
    };
  }

  if (
    foreground === 'game' &&
    !gamepadActive &&
    (idleSec ?? 0) >= 240 &&
    !audioActive
  ) {
    shouldProbeScreen = true;
    reasons.push('foreground_game_without_input_needs_probe');
    return {
      state: 'UNKNOWN',
      confidence: toConfidence(0.48),
      reasons,
      shouldProbeScreen,
    };
  }

  if (gamepadActive || foreground === 'game') {
    reasons.push(gamepadActive ? 'gamepad_active' : 'foreground_game');
    if (rawInputActive) reasons.push('raw_input_active');
    return {
      state: 'PLAY',
      confidence: toConfidence(gamepadActive ? 0.95 : 0.86),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (
    (fullscreen || foreground === 'player') &&
    audioActive &&
    (idleSec ?? 0) >= 30
  ) {
    reasons.push(fullscreen ? 'fullscreen_with_audio' : 'player_with_audio');
    return {
      state: 'CONSUME',
      confidence: toConfidence(0.88),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (
    (foreground === 'ide' ||
      foreground === 'terminal' ||
      (foreground === 'browser' && apm >= 60)) &&
    (idleSec ?? 0) < 210 &&
    !fullscreen
  ) {
    reasons.push(`foreground_${foreground}`);
    if (switchRate >= 8) {
      reasons.push('window_switch_high');
    }
    if (
      hasKeyword(foregroundTitle, [
        'debug',
        'breakpoint',
        'exception',
        'attach',
      ])
    ) {
      reasons.push('semantic_focus_stress');
    } else if (
      hasKeyword(foregroundTitle, ['build', 'compile', 'ci', 'test'])
    ) {
      reasons.push('semantic_focus_build');
    } else if (
      hasKeyword(foregroundTitle, ['readme', 'docs', 'notion', 'wiki'])
    ) {
      reasons.push('semantic_focus_doc');
    }
    return {
      state: 'FOCUS',
      confidence: toConfidence(switchRate >= 8 ? 0.9 : 0.82),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (
    idleSec !== undefined &&
    idleSec >= 360 &&
    !audioActive &&
    !fullscreen &&
    !gamepadActive &&
    !rawInputActive &&
    switchRate <= 1
  ) {
    reasons.push('long_idle_without_media_or_gamepad');
    return {
      state: 'AWAY',
      confidence: toConfidence(0.84),
      reasons,
      shouldProbeScreen: false,
    };
  }

  if (
    (idleSec ?? 0) >= 90 &&
    (audioActive || fullscreen || foreground === 'player')
  ) {
    shouldProbeScreen = true;
    reasons.push('idle_with_media_signal_needs_probe');
  }

  if (looksLikeProtectedCapture) {
    reasons.push('capture_limitations_present');
  }
  if (signals.stateTransition) {
    reasons.push(
      `state_transition_${String(signals.stateTransition).toLowerCase()}`,
    );
  }
  reasons.push(`foreground_${foreground}`);
  return {
    state: 'UNKNOWN',
    confidence: toConfidence(0.5),
    reasons,
    shouldProbeScreen,
  };
}
