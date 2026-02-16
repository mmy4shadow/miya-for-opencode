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
  residency: 'hot' | 'warm';
}

interface OffloadedModel {
  modelID: string;
  vramMB: number;
  offloadedAtMs: number;
  reason: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export class ResourceScheduler {
  private readonly projectDir: string;
  private readonly totalVramMB: number;
  private readonly safetyMarginMB: number;
  private readonly maxConcurrentTasks: number;
  private readonly hotsetLimitMB: number;
  private readonly warmPoolLimitMB: number;
  private readonly maxOffloadedModels: number;
  private readonly queue: PendingRequest[] = [];
  private readonly active = new Map<string, ActiveLease>();
  private readonly loadedModels = new Map<string, LoadedModel>();
  private readonly offloadedModels = new Map<string, OffloadedModel>();
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
    this.hotsetLimitMB = Math.max(
      512,
      Math.min(
        this.totalVramMB,
        toNumber(
          process.env.MIYA_RESOURCE_HOTSET_MB,
          Math.max(1024, Math.floor(this.totalVramMB * 0.55)),
        ),
      ),
    );
    const warmPoolCapacity = Math.max(0, this.totalVramMB - this.hotsetLimitMB);
    this.warmPoolLimitMB =
      warmPoolCapacity <= 0
        ? 0
        : warmPoolCapacity <= 256
          ? warmPoolCapacity
          : Math.max(
              256,
              Math.min(
                warmPoolCapacity,
                toNumber(
                  process.env.MIYA_RESOURCE_WARMPOOL_MB,
                  Math.max(512, Math.floor(this.totalVramMB * 0.25)),
                ),
              ),
            );
    this.maxOffloadedModels = Math.max(8, toNumber(process.env.MIYA_RESOURCE_OFFLOAD_MAX, 64));
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
    const loadedModels = [...this.loadedModels.values()].sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs);
    const hotsetUsedMB = loadedModels
      .filter((model) => model.residency === 'hot')
      .reduce((sum, model) => sum + model.vramMB, 0);
    const warmPoolUsedMB = loadedModels
      .filter((model) => model.residency === 'warm')
      .reduce((sum, model) => sum + model.vramMB, 0);
    return {
      timestamp: nowIso(),
      totalVramMB: this.totalVramMB,
      safetyMarginMB: this.safetyMarginMB,
      usedVramMB: this.usedVramMB,
      activeTasks: this.active.size,
      queueDepth: this.queue.length,
      loadedModels: loadedModels
        .map((model) => ({
          modelID: model.modelID,
          vramMB: model.vramMB,
          pins: model.pins,
          lastUsedAt: new Date(model.lastUsedAtMs).toISOString(),
          residency: model.residency,
        })),
      hydraulics: {
        hotsetLimitMB: this.hotsetLimitMB,
        warmPoolLimitMB: this.warmPoolLimitMB,
        hotsetUsedMB,
        warmPoolUsedMB,
        offloadedModels: [...this.offloadedModels.values()]
          .sort((a, b) => b.offloadedAtMs - a.offloadedAtMs)
          .map((item) => ({
            modelID: item.modelID,
            vramMB: item.vramMB,
            offloadedAt: new Date(item.offloadedAtMs).toISOString(),
            reason: item.reason,
          })),
      },
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
    this.rebalanceHydraulics();
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

    const modelVramMB = request.modelID
      ? Math.max(
          0,
          Math.floor(request.modelVramMB ?? request.vramMB ?? 0),
        )
      : 0;
    const neededVramMB = Math.max(0, Math.floor(request.vramMB ?? 0));
    if (neededVramMB + modelVramMB <= 0) return true;
    this.rebalanceHydraulics();
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
      if (existing.residency !== 'hot') existing.residency = 'hot';
      return;
    }
    const offloaded = this.offloadedModels.get(modelID);
    if (offloaded) {
      this.offloadedModels.delete(modelID);
      appendSchedulerEvent(this.projectDir, {
        at: nowIso(),
        type: 'model_reloaded',
        modelID,
        vramMB: offloaded.vramMB,
        reason: offloaded.reason,
      });
    }
    this.evictModelsIfNeeded(vramMB);
    this.loadedModels.set(modelID, {
      modelID,
      vramMB,
      pins: 0,
      lastUsedAtMs: Date.now(),
      residency: 'hot',
    });
    appendSchedulerEvent(this.projectDir, {
      at: nowIso(),
      type: 'model_loaded',
      modelID,
      vramMB,
    });
    this.rebalanceHydraulics();
  }

  private evictModelsIfNeeded(requiredVramMB: number): void {
    if (requiredVramMB <= 0) return;
    if (this.availableVramMB() >= requiredVramMB) return;
    const candidates = [...this.loadedModels.values()]
      .filter((item) => item.pins <= 0)
      .sort((a, b) => a.lastUsedAtMs - b.lastUsedAtMs);
    for (const candidate of candidates) {
      this.offloadModel(candidate, 'lru_evict');
      if (this.availableVramMB() >= requiredVramMB) break;
    }
  }

  private offloadModel(model: LoadedModel, reason: string): void {
    this.loadedModels.delete(model.modelID);
    this.offloadedModels.set(model.modelID, {
      modelID: model.modelID,
      vramMB: model.vramMB,
      offloadedAtMs: Date.now(),
      reason,
    });
    if (this.offloadedModels.size > this.maxOffloadedModels) {
      const stale = [...this.offloadedModels.values()].sort((a, b) => a.offloadedAtMs - b.offloadedAtMs);
      const trim = stale.slice(0, Math.max(0, this.offloadedModels.size - this.maxOffloadedModels));
      for (const item of trim) {
        this.offloadedModels.delete(item.modelID);
      }
    }
    appendSchedulerEvent(this.projectDir, {
      at: nowIso(),
      type: 'model_unloaded',
      modelID: model.modelID,
      vramMB: model.vramMB,
      reason,
    });
  }

  private pinModel(modelID: string): void {
    const model = this.loadedModels.get(modelID);
    if (!model) return;
    model.pins += 1;
    model.lastUsedAtMs = Date.now();
    model.residency = 'hot';
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

  private rebalanceHydraulics(): void {
    if (this.loadedModels.size === 0) return;
    let hotUsed = 0;
    let warmUsed = 0;
    const candidates = [...this.loadedModels.values()].sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs);
    const toOffload: LoadedModel[] = [];
    for (const model of candidates) {
      const previous = model.residency;
      let next: 'hot' | 'warm' | 'offload';
      if (model.pins > 0) {
        next = 'hot';
      } else if (hotUsed + model.vramMB <= this.hotsetLimitMB) {
        next = 'hot';
      } else if (warmUsed + model.vramMB <= this.warmPoolLimitMB) {
        next = 'warm';
      } else {
        next = 'offload';
      }
      if (next === 'hot') {
        hotUsed += model.vramMB;
      } else if (next === 'warm') {
        warmUsed += model.vramMB;
      } else {
        toOffload.push(model);
      }
      if (next !== 'offload' && previous !== next) {
        model.residency = next;
        appendSchedulerEvent(this.projectDir, {
          at: nowIso(),
          type: 'model_residency',
          modelID: model.modelID,
          residency: next,
        });
      }
    }
    for (const model of toOffload) {
      this.offloadModel(model, 'hydraulics_offload');
    }
  }

  private recordSnapshot(): void {
    writeSchedulerSnapshot(this.projectDir, this.snapshot());
  }
}
