import { type SpawnOptionsWithoutStdio, type SpawnSyncOptions } from 'node:child_process';
export interface ProcessResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}
export declare function runProcess(command: string, args: string[], options?: SpawnOptionsWithoutStdio & {
    timeoutMs?: number;
}): Promise<ProcessResult>;
export declare function runProcessSync(command: string, args: string[], options?: SpawnSyncOptions): ProcessResult;
