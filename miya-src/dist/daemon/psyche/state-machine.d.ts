export type SentinelState = 'FOCUS' | 'CONSUME' | 'PLAY' | 'AWAY' | 'UNKNOWN';
export type SentinelForegroundCategory = 'ide' | 'terminal' | 'browser' | 'player' | 'game' | 'chat' | 'other' | 'unknown';
export type ScreenProbeStatus = 'ok' | 'black' | 'error' | 'timeout' | 'not_run';
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
export declare function inferSentinelState(input?: SentinelSignals): SentinelInference;
