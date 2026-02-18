import { ResourceScheduler } from './scheduler';
import type {
  ModelSwapAction,
  ResourceLease,
  ResourceRequest,
  ResourceSchedulerOptions,
  ResourceSchedulerSnapshot,
  ResourceTaskKind,
  VramBudgetModelInput,
  VramBudgetPlan,
  VramBudgetTaskInput,
} from './types';

export { calculateVramBudget, decideModelSwapAction } from './vram';

const schedulers = new Map<string, ResourceScheduler>();

export function getResourceScheduler(
  projectDir: string,
  options?: ResourceSchedulerOptions,
): ResourceScheduler {
  const existing = schedulers.get(projectDir);
  if (existing) return existing;
  const created = new ResourceScheduler(projectDir, options);
  schedulers.set(projectDir, created);
  return created;
}

export type {
  ModelSwapAction,
  ResourceLease,
  ResourceRequest,
  ResourceSchedulerOptions,
  ResourceSchedulerSnapshot,
  ResourceTaskKind,
  VramBudgetModelInput,
  VramBudgetPlan,
  VramBudgetTaskInput,
};
