export type ResourceTaskKind = 'image.generate' | 'vision.analyze' | 'voice.tts' | 'voice.asr' | 'training.image' | 'training.voice' | 'shell.exec' | 'generic';
export interface ResourceRequest {
    kind: ResourceTaskKind;
    priority?: number;
    vramMB?: number;
    modelID?: string;
    modelVramMB?: number;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
}
export interface ResourceLease {
    id: string;
    kind: ResourceTaskKind;
    grantedAt: string;
    vramMB: number;
    release: () => void;
}
export interface ResourceSchedulerOptions {
    totalVramMB?: number;
    safetyMarginMB?: number;
    maxConcurrentTasks?: number;
    hotsetModelIDs?: string[];
    warmPoolLimit?: number;
    isolateTrainingLane?: boolean;
}
export interface ResourceSchedulerSnapshot {
    timestamp: string;
    totalVramMB: number;
    safetyMarginMB: number;
    usedVramMB: number;
    activeTasks: number;
    queueDepth: number;
    loadedModels: Array<{
        modelID: string;
        vramMB: number;
        pins: number;
        lastUsedAt: string;
    }>;
    hotsetModelIDs: string[];
    warmPoolModels: Array<{
        modelID: string;
        cachedAt: string;
    }>;
}
export interface VramBudgetModelInput {
    modelID: string;
    vramMB: number;
    required: boolean;
}
export interface VramBudgetTaskInput {
    taskID: string;
    taskVramMB: number;
    priority?: number;
}
export interface VramBudgetPlan {
    fit: boolean;
    availableMB: number;
    requiredMB: number;
    overflowMB: number;
    suggestedTaskVramMB: number;
    canUseReferenceOnly: boolean;
    modelPlan: {
        keepLoaded: string[];
        unloadFirst: string[];
    };
}
export type ModelSwapAction = 'reuse' | 'hot_load' | 'evict_then_load' | 'degraded_reference';
