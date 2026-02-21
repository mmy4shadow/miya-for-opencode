import { type AutoflowManager, type AutoflowRunResult } from '../../autoflow';
import type { RouteExecutionPlan } from '../../router';
import type { UltraworkTaskInput } from '../../ultrawork/types';
export interface AutoParallelStats {
    triggered: number;
    succeeded: number;
    failed: number;
    totalDagNodes: number;
    totalDagCompleted: number;
}
export interface AutoParallelOutcome {
    ok: boolean;
    summary: string;
    flow: AutoflowRunResult;
    tasks: UltraworkTaskInput[];
}
export declare function executeAutoParallelWorkflow(input: {
    projectDir: string;
    sessionID: string;
    text: string;
    plan: RouteExecutionPlan;
    manager: AutoflowManager;
}): Promise<AutoParallelOutcome>;
