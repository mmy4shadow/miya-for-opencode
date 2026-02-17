import { type ReflectResult } from './memory-reflect';
export interface ReflectWorkerRequest {
    reason: 'manual' | 'auto_idle' | 'session_end' | 'budget_retry';
    force?: boolean;
    minLogs?: number;
    maxLogs?: number;
    maxWrites?: number;
    cooldownMinutes?: number;
}
export interface ReflectWorkerJob {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    request: ReflectWorkerRequest;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    mergedConflicts?: number;
    result?: Pick<ReflectResult, 'jobID' | 'processedLogs' | 'generatedTriplets' | 'generatedFacts' | 'generatedInsights' | 'generatedPreferences' | 'archivedLogs'>;
    error?: string;
}
export declare function enqueueReflectWorkerJob(projectDir: string, request: ReflectWorkerRequest): ReflectWorkerJob;
export declare function listReflectWorkerJobs(projectDir: string, limit?: number): ReflectWorkerJob[];
export declare function scheduleAutoReflectJob(projectDir: string, input?: {
    idleMinutes?: number;
    minPendingLogs?: number;
    cooldownMinutes?: number;
    maxLogs?: number;
    maxWrites?: number;
}): ReflectWorkerJob | null;
export declare function runReflectWorkerTick(projectDir: string, input?: {
    maxJobs?: number;
    writeBudget?: number;
    mergeBudget?: number;
}): {
    processed: number;
    completed: number;
    failed: number;
    jobs: ReflectWorkerJob[];
};
