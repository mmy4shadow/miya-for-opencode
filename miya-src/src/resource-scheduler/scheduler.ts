import { randomUUID } from 'node:crypto';
import { appendSchedulerEvent, writeSchedulerSnapshot } from './store';
import { calculateVramBudget, decideModelSwapAction } from './vram';
import type {
  ModelSwapAction,
  ResourceLease,
  ResourceRequest,
  ResourceSchedulerOptions,
  ResourceSchedulerSnapshot,
  VramBudgetPlan,
} from './types';

interface PendingRequest {
  id: string;
  request: ResourceRequest;
  createdAtMs: number;
  timeoutAtMs?: number;
  resolve: (lease: ResourceLease) => void;
  reject: (error: Error) => void;
}

interface ActiveLease {
  id: string;
  kind: ResourceRequest['kind'];
  grantedAt: string;
  requestVramMB: number;
  modelID?: string;
}

interface LoadedModel {
  modelID: string;
  vramMB: number;
  pins: number;
  lastUsedAtMs: number;
}

interface WarmPoolEntry {
  modelID: string;
  cachedAtMs: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function toStringList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export class ResourceScheduler {
  private readonly projectDir: string;
  private readonly totalVramMB: number;
  private readonly safetyMarginMB: number;
  private readonly maxConcurrentTasks: number;
  private readonly hotsetModelIDs = new Set<string>();
  private readonly warmPool = new Map<string, WarmPoolEntry>();
  private readonly warmPoolLimit: number;
  private readonly isolateTrainingLane: boolean;
  private readonly queue: PendingRequest[] = [];
  private readonly active = new Map<string, ActiveLease>();
  private readonly loadedModels = new Map<string, LoadedModel>();
  private readonly currentModelByKind = new Map<ResourceRequest['kind'], string>();
  private usedVramMB = 0;
  private draining = false;

  constructor(projectDir: string, options: ResourceSchedulerOptions = {}) {
    this.projectDir = projectDir;
    this.totalVramMB = Math.min(
      8192,
      options.totalVramMB ??
        toNumber(process.env.MIYA_RESOURCE_TOTAL_VRAM_MB, 8192),
    );
    this.safetyMarginMB =
      options.safetyMarginMB ??
      toNumber(process.env.MIYA_RESOURCE_SAFETY_MARGIN_MB, 768);
    this.maxConcurrentTasks =
      options.maxConcurrentTasks ??
      toNumber(process.env.MIYA_RESOURCE_MAX_CONCURRENT, 2);
    this.warmPoolLimit =
      options.warmPoolLimit ??
      toNumber(process.env.MIYA_RESOURCE_WARM_POOL_LIMIT, 8);
    this.isolateTrainingLane =
      options.isolateTrainingLane ??
      process.env.MIYA_RESOURCE_ISOLATE_TRAINING_LANE !== '0';
    const hotset = new Set<string>([
      ...(Array.isArray(options.hotsetModelIDs) ? options.hotsetModelIDs : []),
      ...toStringList(process.env.MIYA_RESOURCE_HOTSET_MODELS),
    ]);
    for (const modelID of hotset) {
      if (modelID) this.hotsetModelIDs.add(modelID);
    }
    this.recordSnapshot();
  }

  async acquire(request: ResourceRequest): Promise<ResourceLease> {
    const pendingID = `lease_${randomUUID()}`;
    return new Promise<ResourceLease>((resolve, reject) => {
      const timeoutMs =
        typeof request.timeoutMs === 'number' && request.timeoutMs > 0
          ? request.timeoutMs
          : undefined;
      const timeoutAtMs = timeoutMs ? Date.now() + timeoutMs : undefined;
      const pending: PendingRequest = {
        id: pendingID,
        request,
        createdAtMs: Date.now(),
        timeoutAtMs,
        resolve,
        reject,
      };

      this.queue.push(pending);
      this.queue.sort((a, b) => {
        const priorityA = a.request.priority ?? 0;
        const priorityB = b.request.priority ?? 0;
        if (priorityA !== priorityB) return priorityB - priorityA;
        return a.createdAtMs - b.createdAtMs;
      });
      appendSchedulerEvent(this.projectDir, {
        at: nowIso(),
        type: 'queued',
        leaseID: pendingID,
        kind: request.kind,
        priority: request.priority ?? 0,
        requestedVramMB: request.vramMB ?? 0,
        modelID: request.modelID,
      });
      this.recordSnapshot();
      this.scheduleDrain();
    });
  }

  async withLease<T>(
    request: ResourceRequest,
    run: () => Promise<T> | T,
  ): Promise<T> {
    const lease = await this.acquire(request);
    try {
      return await run();
    } finally {
      lease.release();
    }
  }

  snapshot(): ResourceSchedulerSnapshot {
    return {
      timestamp: nowIso(),
      totalVramMB: this.totalVramMB,
      safetyMarginMB: this.safetyMarginMB,
      usedVramMB: this.usedVramMB,
      activeTasks: this.active.size,
      queueDepth: this.queue.length,
      loadedModels: [...this.loadedModels.values()]
        .sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)
        .map((model) => ({
          modelID: model.modelID,
          vramMB: model.vramMB,
          pins: model.pins,
          lastUsedAt: new Date(model.lastUsedAtMs).toISOString(),
        })),
      hotsetModelIDs: [...this.hotsetModelIDs.values()],
      warmPoolModels: [...this.warmPool.values()]
        .sort((a, b) => b.cachedAtMs - a.cachedAtMs)
        .map((model) => ({
          modelID: model.modelID,
          cachedAt: new Date(model.cachedAtMs).toISOString(),
        })),
    };
  }

  planVramBudget(request: ResourceRequest): VramBudgetPlan {
    return calculateVramBudget({
      snapshot: this.snapshot(),
      task: {
        taskID: request.kind,
        taskVramMB: Math.max(0, Math.floor(request.vramMB ?? 0)),
        priority: request.priority,
      },
      models: request.modelID
        ? [
            {
              modelID: request.modelID,
              vramMB: Math.max(
                0,
                Math.floor(request.modelVramMB ?? request.vramMB ?? 0),
              ),
              required: true,
            },
          ]
        : [],
    });
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => {
      this.draining = false;
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      this.removeExpiredPending();

      if (this.active.size >= this.maxConcurrentTasks) return;
      const pending = this.queue[0];
      if (!pending) return;

      if (!this.canGrant(pending.request)) return;
      this.queue.shift();
      const grantedAt = nowIso();
      const requestVramMB = Math.max(0, Math.floor(pending.request.vramMB ?? 0));
      const lease: ActiveLease = {
        id: pending.id,
        kind: pending.request.kind,
        grantedAt,
        requestVramMB,
        modelID: pending.request.modelID,
      };
      this.active.set(lease.id, lease);

      if (requestVramMB > 0) this.usedVramMB += requestVramMB;
      if (pending.request.modelID) {
        const modelVramMB = Math.max(
          0,
          Math.floor(pending.request.modelVramMB ?? requestVramMB),
        );
        const swapAction = this.selectModelSwapAction(
          pending.request.kind,
          pending.request.modelID,
          pending.request,
        );
        if (swapAction === 'evict_then_load') {
          this.evictModelsIfNeeded(modelVramMB);
        }
        this.ensureModelLoaded(pending.request.modelID, modelVramMB);
        this.pinModel(pending.request.modelID);
        this.currentModelByKind.set(pending.request.kind, pending.request.modelID);
        appendSchedulerEvent(this.projectDir, {
          at: nowIso(),
          type: 'model_swap',
          kind: pending.request.kind,
          action: swapAction,
          modelID: pending.request.modelID,
          vramMB: modelVramMB,
        });
      }

      appendSchedulerEvent(this.projectDir, {
        at: grantedAt,
        type: 'granted',
        leaseID: lease.id,
        kind: lease.kind,
        requestedVramMB: requestVramMB,
        modelID: lease.modelID,
      });
      this.recordSnapshot();

      pending.resolve({
        id: lease.id,
        kind: lease.kind,
        grantedAt,
        vramMB: requestVramMB,
        release: () => this.release(lease.id),
      });
      progressed = true;
    }
  }

  private release(leaseID: string): void {
    const lease = this.active.get(leaseID);
    if (!lease) return;
    this.active.delete(leaseID);
    if (lease.requestVramMB > 0) {
      this.usedVramMB = Math.max(0, this.usedVramMB - lease.requestVramMB);
    }
    if (lease.modelID) {
      this.unpinModel(lease.modelID);
      this.touchModel(lease.modelID);
    }
    appendSchedulerEvent(this.projectDir, {
      at: nowIso(),
      type: 'released',
      leaseID,
      kind: lease.kind,
      releasedVramMB: lease.requestVramMB,
      modelID: lease.modelID,
    });
    this.recordSnapshot();
    this.scheduleDrain();
  }

  private canGrant(request: ResourceRequest): boolean {
    if (this.active.size >= this.maxConcurrentTasks) return false;
    if (this.isolateTrainingLane) {
      if (this.isTrainingKind(request.kind) && this.hasActiveInferenceTask()) return false;
      if (!this.isTrainingKind(request.kind) && this.hasActiveTrainingTask()) return false;
    }

    const neededVramMB = Math.max(0, Math.floor(request.vramMB ?? 0));
    if (neededVramMB === 0) return true;

    const modelVramMB = request.modelID
      ? Math.max(
          0,
          Math.floor(request.modelVramMB ?? request.vramMB ?? 0),
        )
      : 0;
    this.evictModelsIfNeeded(neededVramMB + modelVramMB);
    return this.availableVramMB() >= neededVramMB + modelVramMB;
  }

  private selectModelSwapAction(
    kind: ResourceRequest['kind'],
    targetModelID: string,
    request: ResourceRequest,
  ): ModelSwapAction {
    const budget = this.planVramBudget(request);
    return decideModelSwapAction({
      currentModelID: this.currentModelByKind.get(kind),
      targetModelID,
      budget,
    });
  }

  private availableVramMB(): number {
    return Math.max(
      0,
      this.totalVramMB - this.safetyMarginMB - this.usedVramMB - this.loadedModelsVramMB(),
    );
  }

  private loadedModelsVramMB(): number {
    let sum = 0;
    for (const model of this.loadedModels.values()) sum += model.vramMB;
    return sum;
  }

  private removeExpiredPending(): void {
    const now = Date.now();
    const keep: PendingRequest[] = [];
    for (const pending of this.queue) {
      if (pending.timeoutAtMs && pending.timeoutAtMs <= now) {
        appendSchedulerEvent(this.projectDir, {
          at: nowIso(),
          type: 'timeout',
          leaseID: pending.id,
          kind: pending.request.kind,
        });
        pending.reject(new Error('resource_acquire_timeout'));
      } else {
        keep.push(pending);
      }
    }
    if (keep.length !== this.queue.length) {
      this.queue.length = 0;
      this.queue.push(...keep);
      this.recordSnapshot();
    }
  }

  private ensureModelLoaded(modelID: string, vramMB: number): void {
    if (!modelID || vramMB <= 0) return;
    const existing = this.loadedModels.get(modelID);
    if (existing) {
      existing.lastUsedAtMs = Date.now();
      return;
    }
    const warmEntry = this.warmPool.get(modelID);
    if (warmEntry) {
      this.warmPool.delete(modelID);
      appendSchedulerEvent(this.projectDir, {
        at: nowIso(),
        type: 'model_restored_from_warm_pool',
        modelID,
      });
    }
    this.evictModelsIfNeeded(vramMB);
    this.loadedModels.set(modelID, {
      modelID,
      vramMB,
      pins: 0,
      lastUsedAtMs: Date.now(),
    });
    appendSchedulerEvent(this.projectDir, {
      at: nowIso(),
      type: 'model_loaded',
      modelID,
      vramMB,
    });
  }

  private evictModelsIfNeeded(requiredVramMB: number): void {
    if (requiredVramMB <= 0) return;
    if (this.availableVramMB() >= requiredVramMB) return;
    const candidates = [...this.loadedModels.values()]
      .filter((item) => item.pins <= 0)
      .sort((a, b) => {
        const hotA = this.hotsetModelIDs.has(a.modelID) ? 1 : 0;
        const hotB = this.hotsetModelIDs.has(b.modelID) ? 1 : 0;
        if (hotA !== hotB) return hotA - hotB;
        return a.lastUsedAtMs - b.lastUsedAtMs;
      });
    for (const candidate of candidates) {
      this.loadedModels.delete(candidate.modelID);
      this.addToWarmPool(candidate.modelID);
      appendSchedulerEvent(this.projectDir, {
        at: nowIso(),
        type: 'model_unloaded',
        modelID: candidate.modelID,
        vramMB: candidate.vramMB,
        reason: 'lru_evict',
      });
      if (this.availableVramMB() >= requiredVramMB) break;
    }
  }

  private pinModel(modelID: string): void {
    const model = this.loadedModels.get(modelID);
    if (!model) return;
    model.pins += 1;
    model.lastUsedAtMs = Date.now();
  }

  private unpinModel(modelID: string): void {
    const model = this.loadedModels.get(modelID);
    if (!model) return;
    model.pins = Math.max(0, model.pins - 1);
    model.lastUsedAtMs = Date.now();
  }

  private touchModel(modelID: string): void {
    const model = this.loadedModels.get(modelID);
    if (!model) return;
    model.lastUsedAtMs = Date.now();
  }

  private isTrainingKind(kind: ResourceRequest['kind']): boolean {
    return kind === 'training.image' || kind === 'training.voice';
  }

  private hasActiveTrainingTask(): boolean {
    for (const lease of this.active.values()) {
      if (this.isTrainingKind(lease.kind)) return true;
    }
    return false;
  }

  private hasActiveInferenceTask(): boolean {
    for (const lease of this.active.values()) {
      if (!this.isTrainingKind(lease.kind)) return true;
    }
    return false;
  }

  private addToWarmPool(modelID: string): void {
    if (!modelID || this.hotsetModelIDs.has(modelID) || this.warmPoolLimit <= 0) return;
    this.warmPool.set(modelID, {
      modelID,
      cachedAtMs: Date.now(),
    });
    this.pruneWarmPool();
  }

  private pruneWarmPool(): void {
    if (this.warmPool.size <= this.warmPoolLimit) return;
    const entries = [...this.warmPool.values()].sort((a, b) => a.cachedAtMs - b.cachedAtMs);
    while (this.warmPool.size > this.warmPoolLimit) {
      const candidate = entries.shift();
      if (!candidate) break;
      this.warmPool.delete(candidate.modelID);
    }
  }

  private recordSnapshot(): void {
    writeSchedulerSnapshot(this.projectDir, this.snapshot());
  }
}
