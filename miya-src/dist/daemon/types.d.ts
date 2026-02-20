import type { ResourceRequest, ResourceTaskKind } from '../resource-scheduler';
export type DaemonJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
export interface DaemonJobRequest {
    kind: ResourceTaskKind;
    resource?: Omit<ResourceRequest, 'kind'>;
    metadata?: Record<string, unknown>;
}
export interface DaemonJobRecord {
    id: string;
    kind: ResourceTaskKind;
    status: DaemonJobStatus;
    progress?: number;
    statusText?: string;
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    error?: string;
    metadata?: Record<string, unknown>;
}
export interface DaemonJobProgressEvent {
    jobID: string;
    kind: ResourceTaskKind;
    progress: number;
    status: string;
    phase: string;
    updatedAt: string;
    etaSec?: number;
    audioCue?: {
        cueID: string;
        text: string;
        clipPath?: string;
        source: 'asset' | 'fallback';
        expectedLatencyMs: number;
    };
}
export interface DaemonRuntimeState {
    status: 'running' | 'stopped';
    pid: number;
    startedAt: string;
    updatedAt: string;
    sessionID: string;
}
export interface DaemonRunResult<T> {
    job: DaemonJobRecord;
    result: T;
}
