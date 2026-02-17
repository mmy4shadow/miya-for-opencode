import { type CompanionMemoryVector } from './memory-vector';
export interface MemoryShortTermLog {
    id: string;
    sessionID: string;
    sender: 'user' | 'assistant' | 'system';
    text: string;
    at: string;
    messageHash: string;
    processedAt?: string;
}
export interface ReflectResult {
    jobID: string;
    processedLogs: number;
    generatedTriplets: number;
    generatedFacts: number;
    generatedInsights: number;
    generatedPreferences: number;
    createdMemories: CompanionMemoryVector[];
    archivedLogs: number;
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
    maxWrites?: number;
    mergeConflicts?: boolean;
    idempotencyKey?: string;
    cooldownMinutes?: number;
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
