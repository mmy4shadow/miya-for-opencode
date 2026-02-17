import type { ModelSwapAction, ResourceSchedulerSnapshot, VramBudgetModelInput, VramBudgetPlan, VramBudgetTaskInput } from './types';
export declare function calculateVramBudget(input: {
    snapshot: ResourceSchedulerSnapshot;
    task: VramBudgetTaskInput;
    models: VramBudgetModelInput[];
}): VramBudgetPlan;
export declare function decideModelSwapAction(input: {
    currentModelID?: string;
    targetModelID?: string;
    budget: VramBudgetPlan;
}): ModelSwapAction;
