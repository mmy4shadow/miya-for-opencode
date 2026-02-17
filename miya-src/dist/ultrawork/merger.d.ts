import type { BackgroundTaskManager } from '../background';
import type { UltraworkDagResult } from './scheduler';
export declare function mergeUltraworkResults(manager: BackgroundTaskManager, taskIDs: string[]): string;
export declare function formatUltraworkDagResult(result: UltraworkDagResult): string;
