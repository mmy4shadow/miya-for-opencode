import type { GatewayMode } from './sanitizer';
export interface ModeObservabilityStore {
    version: 1;
    totals: {
        turns: number;
        modeSwitches: number;
        misclassificationRollbacks: number;
        autonomousAttempts: number;
        autonomousCompletions: number;
        negativeFeedbackTurns: number;
    };
    lastMode?: GatewayMode;
    lastTurnID?: string;
    updatedAt: string;
}
export interface ModeObservationInput {
    turnID: string;
    finalMode: GatewayMode;
    rollback: boolean;
    autonomousAttempt: boolean;
    autonomousSuccess: boolean;
    negativeFeedback: boolean;
}
export interface ModeObservabilitySnapshot {
    totals: ModeObservabilityStore['totals'];
    metrics: {
        modeSwitchFrequency: number;
        misclassificationRollbackRate: number;
        autonomousTaskCompletionRate: number;
        userNegativeFeedbackRate: number;
    };
    lastMode?: GatewayMode;
    lastTurnID?: string;
    updatedAt: string;
}
export declare function readModeObservability(projectDir: string): ModeObservabilitySnapshot;
export declare function recordModeObservability(projectDir: string, input: ModeObservationInput): ModeObservabilitySnapshot;
export declare function detectNegativeFeedbackText(text: string): boolean;
