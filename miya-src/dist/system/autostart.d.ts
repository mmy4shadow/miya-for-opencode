export type AutostartConflictKind = 'legacy_miya_start_command' | 'duplicate_miya_gateway_task' | 'external_gateway_task';
export interface AutostartConflict {
    taskName: string;
    command: string;
    state?: string;
    kind: AutostartConflictKind;
}
export interface AutostartConflictResolution {
    scanned: number;
    conflictCount: number;
    conflicts: AutostartConflict[];
    disabled: string[];
    failed: Array<{
        taskName: string;
        reason: string;
    }>;
}
export interface AutostartState {
    enabled: boolean;
    taskName: string;
    command: string;
    updatedAt: string;
}
export interface AutostartStatus {
    platform: NodeJS.Platform;
    supported: boolean;
    enabled: boolean;
    installed: boolean;
    taskName: string;
    command: string;
    conflictDetected: boolean;
    conflicts: AutostartConflict[];
    updatedAt?: string;
    reason?: string;
}
export declare function reconcileAutostartConflicts(projectDir: string, input?: {
    disableConflicts?: boolean;
}): AutostartConflictResolution;
export declare function getAutostartStatus(projectDir: string): AutostartStatus;
export declare function setAutostartEnabled(projectDir: string, input: {
    enabled: boolean;
    taskName?: string;
    command?: string;
    resolveConflicts?: boolean;
}): AutostartStatus;
