import type { DaemonJobRecord, DaemonRuntimeState } from './types';
export declare function writeDaemonRuntimeState(projectDir: string, state: DaemonRuntimeState): void;
export declare function appendDaemonJob(projectDir: string, record: DaemonJobRecord): void;
