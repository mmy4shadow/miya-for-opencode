import type { CompanionMemoryVector, MemoryShortTermLog } from './memory-types';
export interface ReflectResult {
    jobID: string;
    processedLogs: number;
    generatedTriplets: number;
    generatedFacts: number;
    generatedInsights: number;
    generatedPreferences: number;
    createdMemories: CompanionMemoryVector[];
    archivedLogs: number;
    auditID: string;
}
export interface ReflectStatus {
    pendingLogs: number;
    lastLogAt?: string;
    lastReflectAt?: string;
}
export declare function appendShortTermMemoryLog(projectDir: string, input: {
    sessionID?: string;
    sender: 'user' | 'assistant' | 'system';
    text: string;
    at?: string;
    messageID?: string;
}): MemoryShortTermLog | null;
export declare function getMemoryReflectStatus(projectDir: string): ReflectStatus;
export declare function reflectCompanionMemory(projectDir: string, input?: {
    force?: boolean;
    minLogs?: number;
    maxLogs?: number;
    idempotencyKey?: string;
    cooldownMinutes?: number;
    policyHash?: string;
}): ReflectResult;
export declare function maybeAutoReflectCompanionMemory(projectDir: string, input?: {
    idleMinutes?: number;
    minPendingLogs?: number;
    cooldownMinutes?: number;
    maxLogs?: number;
}): ReflectResult | null;
export declare function maybeReflectOnSessionEnd(projectDir: string, input?: {
    minPendingLogs?: number;
    maxLogs?: number;
}): ReflectResult | null;
