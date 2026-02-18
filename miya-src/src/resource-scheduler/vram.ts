import type {
  ModelSwapAction,
  ResourceSchedulerSnapshot,
  VramBudgetModelInput,
  VramBudgetPlan,
  VramBudgetTaskInput,
} from './types';

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function calculateVramBudget(input: {
  snapshot: ResourceSchedulerSnapshot;
  task: VramBudgetTaskInput;
  models: VramBudgetModelInput[];
}): VramBudgetPlan {
  const availableMB = Math.max(
    0,
    clampNonNegative(input.snapshot.totalVramMB) -
      clampNonNegative(input.snapshot.safetyMarginMB) -
      clampNonNegative(input.snapshot.usedVramMB),
  );

  const loaded = new Map(
    input.snapshot.loadedModels.map((model) => [
      model.modelID,
      clampNonNegative(model.vramMB),
    ]),
  );
  const keepLoaded = new Set<string>();
  let modelsNeedLoadMB = 0;

  for (const model of input.models) {
    if (!model.required) continue;
    const need = clampNonNegative(model.vramMB);
    const loadedMB = loaded.get(model.modelID) ?? 0;
    if (loadedMB >= need) {
      keepLoaded.add(model.modelID);
      continue;
    }
    modelsNeedLoadMB += need;
  }

  const requiredMB = clampNonNegative(input.task.taskVramMB) + modelsNeedLoadMB;
  const overflowMB = Math.max(0, requiredMB - availableMB);
  const fit = overflowMB <= 0;
  const suggestedTaskVramMB = fit
    ? clampNonNegative(input.task.taskVramMB)
    : Math.max(256, clampNonNegative(input.task.taskVramMB) - overflowMB);

  const unloadFirst = input.snapshot.loadedModels
    .filter((model) => model.pins <= 0 && !keepLoaded.has(model.modelID))
    .sort((a, b) => Date.parse(a.lastUsedAt) - Date.parse(b.lastUsedAt))
    .map((model) => model.modelID);

  return {
    fit,
    availableMB,
    requiredMB,
    overflowMB,
    suggestedTaskVramMB,
    canUseReferenceOnly: suggestedTaskVramMB < 512,
    modelPlan: {
      keepLoaded: [...keepLoaded],
      unloadFirst,
    },
  };
}

export function decideModelSwapAction(input: {
  currentModelID?: string;
  targetModelID?: string;
  budget: VramBudgetPlan;
}): ModelSwapAction {
  const current = (input.currentModelID ?? '').trim();
  const target = (input.targetModelID ?? '').trim();
  if (!target) return 'reuse';
  if (current && current === target) return 'reuse';
  if (input.budget.fit) return current ? 'hot_load' : 'reuse';
  if (input.budget.modelPlan.unloadFirst.length > 0) return 'evict_then_load';
  return 'degraded_reference';
}
