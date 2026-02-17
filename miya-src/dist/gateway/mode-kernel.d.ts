import { type SentinelSignals } from '../daemon/psyche';
import { type GatewayMode } from './sanitizer';
export interface ModeKernelSessionState {
    activation?: 'active' | 'queued' | 'muted';
    reply?: 'auto' | 'manual' | 'summary_only';
    queueLength?: number;
    awaitingConfirmation?: boolean;
    loopEnabled?: boolean;
}
export interface ModeKernelInput {
    text: string;
    sanitizerModeHint?: GatewayMode;
    routeComplexity?: {
        complexity: 'low' | 'medium' | 'high';
        score: number;
        reasons: string[];
    };
    psycheSignals?: SentinelSignals;
    sessionState?: ModeKernelSessionState;
    lastMode?: GatewayMode;
}
export interface ModeKernelResult {
    mode: GatewayMode;
    confidence: number;
    why: string[];
    scores: {
        work: number;
        chat: number;
        mixed: number;
    };
}
export declare function evaluateModeKernel(input: ModeKernelInput): ModeKernelResult;
