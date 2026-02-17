import type { ResourceSchedulerSnapshot } from './types';
export declare function writeSchedulerSnapshot(projectDir: string, snapshot: ResourceSchedulerSnapshot): void;
export declare function appendSchedulerEvent(projectDir: string, event: Record<string, unknown>): void;
