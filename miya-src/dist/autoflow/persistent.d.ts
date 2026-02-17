import type { AutoflowManager } from './types';
export interface AutoflowPersistentConfig {
    enabled: boolean;
    resumeCooldownMs: number;
    maxAutoResumes: number;
    maxConsecutiveResumeFailures: number;
    resumeTimeoutMs: number;
}
export interface AutoflowPersistentSessionRuntime {
    sessionID: string;
    resumeAttempts: number;
    resumeFailures: number;
    userStopped: boolean;
    stopIntentToken?: string;
    stopIntentSource?: 'user' | 'system';
    stopIntentRequestedAt?: string;
    stopIntentAckedAt?: string;
    lastStopAt?: string;
    lastStopType?: string;
    lastStopReason?: string;
    lastResumeAt?: string;
    lastOutcomePhase?: string;
    lastOutcomeSummary?: string;
}
export interface AutoflowPersistentEventInput {
    type?: string;
    properties?: {
        sessionID?: string;
        stopIntent?: {
            token?: string;
            source?: string;
        };
        status?: {
            type?: string;
            reason?: string;
            source?: string;
        };
        reason?: string;
        source?: string;
    };
}
export interface AutoflowPersistentEventResult {
    handled: boolean;
    resumed: boolean;
    reason?: string;
    success?: boolean;
    phase?: string;
    summary?: string;
}
export declare function readAutoflowPersistentConfig(projectDir: string): AutoflowPersistentConfig;
export declare function writeAutoflowPersistentConfig(projectDir: string, patch: Partial<AutoflowPersistentConfig>): AutoflowPersistentConfig;
export declare function markAutoflowStopRequested(projectDir: string, input: {
    sessionID: string;
    source?: 'user' | 'system';
    token?: string;
}): AutoflowPersistentSessionRuntime;
export declare function markAutoflowStopAcked(projectDir: string, input: {
    sessionID: string;
    token?: string;
}): AutoflowPersistentSessionRuntime;
export declare function clearAutoflowStopIntent(projectDir: string, sessionID: string): AutoflowPersistentSessionRuntime;
export declare function getAutoflowPersistentRuntimeSnapshot(projectDir: string, limit?: number): AutoflowPersistentSessionRuntime[];
export declare function handleAutoflowPersistentEvent(input: {
    projectDir: string;
    manager: AutoflowManager;
    event: AutoflowPersistentEventInput;
}): Promise<AutoflowPersistentEventResult>;
