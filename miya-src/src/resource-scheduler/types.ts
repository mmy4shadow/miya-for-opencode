export type ResourceTaskKind =
  | 'image.generate'
  | 'vision.analyze'
  | 'voice.tts'
  | 'voice.asr'
  | 'training.image'
  | 'training.voice'
  | 'shell.exec'
  | 'generic';

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
}
