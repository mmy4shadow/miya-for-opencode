import type { UltraworkLaunchResult, UltraworkTaskInput } from './types';
type RuntimeTaskStatus = 'pending' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
interface BackgroundTaskLike {
    id: string;
    agent: string;
    status: RuntimeTaskStatus | string;
    completedAt?: Date;
}
interface UltraworkManagerLike {
    launch(input: {
        agent: string;
        prompt: string;
        description: string;
        parentSessionId: string;
    }): BackgroundTaskLike;
    waitForCompletion(taskID: string, timeoutMs?: number): Promise<BackgroundTaskLike | null>;
    getResult(taskID: string): BackgroundTaskLike | null;
    cancel(taskID?: string): number;
}
export interface UltraworkDagNodeResult {
    nodeID: string;
    agent: string;
    status: RuntimeTaskStatus | 'blocked_dependency' | 'timeout';
    retries: number;
    taskID?: string;
    error?: string;
}
export interface UltraworkDagResult {
    total: number;
    completed: number;
    failed: number;
    blocked: number;
    nodes: UltraworkDagNodeResult[];
}
export declare function launchUltraworkTasks(input: {
    manager: UltraworkManagerLike;
    parentSessionID: string;
    tasks: UltraworkTaskInput[];
}): UltraworkLaunchResult[];
export declare function runUltraworkDag(input: {
    manager: UltraworkManagerLike;
    parentSessionID: string;
    tasks: UltraworkTaskInput[];
    maxParallel?: number;
}): Promise<UltraworkDagResult>;
export {};
