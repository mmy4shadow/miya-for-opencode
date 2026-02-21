import type { DaemonJobRecord, DaemonRuntimeState } from './types';
export declare function writeDaemonRuntimeState(projectDir: string, state: DaemonRuntimeState): void;
export declare function appendDaemonJob(projectDir: string, record: DaemonJobRecord): void;
export declare function appendDaemonRecoveryCheckpoint(projectDir: string, input: {
    sessionID: string;
    jobID: string;
    tier: string;
    step: number;
    totalSteps: number;
    checkpointPath: string;
    reasonCode: string;
}): void;
