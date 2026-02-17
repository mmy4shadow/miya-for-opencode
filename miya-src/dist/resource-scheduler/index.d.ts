import { ResourceScheduler } from './scheduler';
import type { ModelSwapAction, ResourceLease, ResourceRequest, ResourceSchedulerOptions, ResourceSchedulerSnapshot, ResourceTaskKind, VramBudgetModelInput, VramBudgetPlan, VramBudgetTaskInput } from './types';
export { calculateVramBudget, decideModelSwapAction } from './vram';
export declare function getResourceScheduler(projectDir: string, options?: ResourceSchedulerOptions): ResourceScheduler;
export type { ModelSwapAction, ResourceLease, ResourceRequest, ResourceSchedulerOptions, ResourceSchedulerSnapshot, ResourceTaskKind, VramBudgetModelInput, VramBudgetPlan, VramBudgetTaskInput, };
