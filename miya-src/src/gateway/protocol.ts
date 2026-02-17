import { z } from 'zod';

export type GatewayClientRole = 'ui' | 'admin' | 'node' | 'channel' | 'unknown';
export const GATEWAY_PROTOCOL_VERSION = '1.1';
export const LEGACY_GATEWAY_PROTOCOL_VERSION = '1.0';
export const SUPPORTED_GATEWAY_PROTOCOL_VERSIONS = [
  LEGACY_GATEWAY_PROTOCOL_VERSION,
  GATEWAY_PROTOCOL_VERSION,
] as const;

const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(z.string(), JsonValue)]),
);

const JsonObject = z.record(z.string(), JsonValue);

export const PlanBundleAuditEventSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  stage: z.enum(['plan', 'approval', 'execution', 'rollback', 'audit', 'finalize']),
  action: z.string().min(1),
  inputSummary: z.string().min(1),
  inputHash: z.string().min(16),
  approvalBasis: z.string().min(1),
  resultHash: z.string().min(16),
  replayToken: z.string().min(16),
});

export const PlanBundleApprovalSchema = z.object({
  required: z.boolean(),
  approved: z.boolean(),
  approver: z.string().optional(),
  reason: z.string().optional(),
  policyHash: z.string().optional(),
  requestedAt: z.string().optional(),
  approvedAt: z.string().optional(),
});

export const PlanBundleRollbackSchema = z.object({
  command: z.string().optional(),
  attempted: z.boolean(),
  ok: z.boolean().optional(),
  exitCode: z.number().int().optional(),
  result: JsonObject.optional(),
  reason: z.string().optional(),
});

export const PlanBundleSchema = z.object({
  bundleId: z.string().min(1),
  id: z.string().min(1),
  version: z.literal('1.0'),
  goal: z.string().min(1),
  mode: z.enum(['work', 'chat', 'mixed', 'subagent']),
  riskTier: z.enum(['LIGHT', 'STANDARD', 'THOROUGH']),
  lifecycleState: z.enum([
    'draft',
    'proposed',
    'approved',
    'executing',
    'verifying',
    'done',
    'failed',
    'postmortem',
  ]),
  budget: z.object({
    timeMs: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    retries: z.number().int().nonnegative(),
  }),
  capabilitiesNeeded: z.array(z.string().min(1)),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      intent: z.string().min(1),
      tools: z.array(z.string().min(1)),
      expectedArtifacts: z.array(z.string().min(1)),
      rollback: z.string().min(1),
      done: z.boolean(),
      command: z.string().optional(),
    }),
  ),
  approvalPolicy: z.object({
    required: z.boolean(),
    mode: z.enum(['manual', 'auto']),
  }),
  verificationPlan: z.object({
    command: z.string().optional(),
    checks: z.array(z.string().min(1)),
  }),
  policyHash: z.string().min(16),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  status: z.enum([
    'draft',
    'pending_approval',
    'approved',
    'running',
    'completed',
    'failed',
    'rolled_back',
  ]),
  plan: z.object({
    goal: z.string().min(1),
    createdAt: z.string().min(1),
    steps: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        kind: z.enum(['analysis', 'execution', 'verification']),
        command: z.string().optional(),
        done: z.boolean(),
        note: z.string().optional(),
      }),
    ),
  }),
  approval: PlanBundleApprovalSchema,
  execution: z.array(JsonObject),
  verification: JsonObject.optional(),
  rollback: PlanBundleRollbackSchema,
  audit: z.array(PlanBundleAuditEventSchema),
});

export const HelloFrameSchema = z.object({
  type: z.literal('hello'),
  role: z.enum(['ui', 'admin', 'node', 'channel', 'unknown']).default('unknown'),
  clientID: z.string().optional(),
  protocolVersion: z.string().optional(),
  auth: z
    .object({
      token: z.string().optional(),
      challenge: z
        .object({
          nonce: z.string().min(8).max(128),
          ts: z.number().int().nonnegative(),
          signature: z.string().min(16).max(256),
        })
        .optional(),
    })
    .optional(),
  capabilities: z.array(z.string()).optional(),
});

export const RequestFrameSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.string().min(1),
  params: JsonObject.default({}),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const PingFrameSchema = z.object({
  type: z.literal('ping'),
  ts: z.number().int().nonnegative(),
});

export const PongFrameSchema = z.object({
  type: z.literal('pong'),
  ts: z.number().int().nonnegative(),
});

export const ResponseFrameSchema = z.object({
  type: z.literal('response'),
  id: z.string(),
  ok: z.boolean(),
  result: JsonValue.optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: JsonValue.optional(),
    })
    .optional(),
});

export const EventFrameSchema = z.object({
  type: z.literal('event'),
  event: z.string().min(1),
  payload: JsonValue,
  stateVersion: z.record(z.string(), z.number()).optional(),
});

export type HelloFrame = z.infer<typeof HelloFrameSchema>;
export type RequestFrame = z.infer<typeof RequestFrameSchema>;
export type ResponseFrame = z.infer<typeof ResponseFrameSchema>;
export type EventFrame = z.infer<typeof EventFrameSchema>;
export type PingFrame = z.infer<typeof PingFrameSchema>;
export type PongFrame = z.infer<typeof PongFrameSchema>;
export type PlanBundleAuditEventFrame = z.infer<typeof PlanBundleAuditEventSchema>;
export type PlanBundleApprovalFrame = z.infer<typeof PlanBundleApprovalSchema>;
export type PlanBundleRollbackFrame = z.infer<typeof PlanBundleRollbackSchema>;
export type PlanBundleFrame = z.infer<typeof PlanBundleSchema>;

export const GatewayIncomingFrameSchema = z.union([HelloFrameSchema, RequestFrameSchema, PingFrameSchema]);
export const GatewayOutgoingFrameSchema = z.union([ResponseFrameSchema, EventFrameSchema, PongFrameSchema]);

export type GatewayIncomingFrame = z.infer<typeof GatewayIncomingFrameSchema>;
export type GatewayOutgoingFrame = z.infer<typeof GatewayOutgoingFrameSchema>;

export interface GatewayMethodContext {
  clientID: string;
  role: GatewayClientRole;
}

export type GatewayMethodHandler = (
  params: Record<string, unknown>,
  context: GatewayMethodContext,
) => Promise<unknown> | unknown;

interface GatewayMethodRegistryOptions {
  maxInFlight?: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
}

interface QueuedInvocation {
  method: string;
  params: Record<string, unknown>;
  context: GatewayMethodContext;
  enqueuedAtMs: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class GatewayMethodRegistry {
  private handlers = new Map<string, GatewayMethodHandler>();
  private inFlight = 0;
  private readonly queue: QueuedInvocation[] = [];
  private rejectedOverloaded = 0;
  private rejectedTimeout = 0;
  private readonly queueWaitSamplesMs: number[] = [];
  private readonly maxInFlight: number;
  private readonly maxQueued: number;
  private readonly queueTimeoutMs: number;

  constructor(options: GatewayMethodRegistryOptions = {}) {
    this.maxInFlight = Math.max(
      1,
      Math.floor(
        options.maxInFlight ??
          Number(process.env.MIYA_GATEWAY_MAX_IN_FLIGHT ?? 8),
      ),
    );
    this.maxQueued = Math.max(
      1,
      Math.floor(
        options.maxQueued ??
          Number(process.env.MIYA_GATEWAY_MAX_QUEUED ?? 64),
      ),
    );
    this.queueTimeoutMs = Math.max(
      100,
      Math.floor(
        options.queueTimeoutMs ??
          Number(process.env.MIYA_GATEWAY_QUEUE_TIMEOUT_MS ?? 15_000),
      ),
    );
  }

  register(method: string, handler: GatewayMethodHandler): void {
    this.handlers.set(method, handler);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  handlerOf(method: string): GatewayMethodHandler | undefined {
    return this.handlers.get(method);
  }

  registerAlias(aliasMethod: string, targetMethod: string): boolean {
    if (aliasMethod === targetMethod) return false;
    if (this.handlers.has(aliasMethod)) return false;
    const target = this.handlers.get(targetMethod);
    if (!target) {
      throw new Error(`alias_target_not_found:${targetMethod}`);
    }
    this.handlers.set(aliasMethod, async (params, context) => target(params, context));
    return true;
  }

  async invoke(
    method: string,
    params: Record<string, unknown>,
    context: GatewayMethodContext,
  ): Promise<unknown> {
    if (this.inFlight < this.maxInFlight) {
      return this.executeNow(method, params, context);
    }
    if (this.queue.length >= this.maxQueued) {
      this.rejectedOverloaded += 1;
      throw new Error(
        `gateway_backpressure_overloaded:in_flight=${this.inFlight}:queued=${this.queue.length}`,
      );
    }
    return await new Promise<unknown>((resolve, reject) => {
      const queued: QueuedInvocation = {
        method,
        params,
        context,
        enqueuedAtMs: Date.now(),
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = this.queue.indexOf(queued);
          if (index >= 0) this.queue.splice(index, 1);
          this.rejectedTimeout += 1;
          reject(new Error('gateway_backpressure_timeout'));
        }, this.queueTimeoutMs),
      };
      this.queue.push(queued);
    });
  }

  list(): string[] {
    return [...this.handlers.keys()].sort();
  }

  stats(): {
    inFlight: number;
    queued: number;
    maxInFlight: number;
    maxQueued: number;
    rejected_overloaded: number;
    rejected_timeout: number;
    queue_wait_ms_p95: number;
    rejectedOverloaded: number;
    rejectedTimeout: number;
    queueWaitMsP95: number;
  } {
    const rejectedOverloaded = this.rejectedOverloaded;
    const rejectedTimeout = this.rejectedTimeout;
    const queueWaitMsP95 = this.queueWaitMsP95();
    return {
      inFlight: this.inFlight,
      queued: this.queue.length,
      maxInFlight: this.maxInFlight,
      maxQueued: this.maxQueued,
      rejected_overloaded: rejectedOverloaded,
      rejected_timeout: rejectedTimeout,
      queue_wait_ms_p95: queueWaitMsP95,
      rejectedOverloaded,
      rejectedTimeout,
      queueWaitMsP95,
    };
  }

  private async executeNow(
    method: string,
    params: Record<string, unknown>,
    context: GatewayMethodContext,
  ): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) throw new Error(`unknown_method:${method}`);
    this.inFlight += 1;
    try {
      return await handler(params, context);
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    if (this.inFlight >= this.maxInFlight) return;
    const next = this.queue.shift();
    if (!next) return;
    clearTimeout(next.timeout);
    this.recordQueueWait(Date.now() - next.enqueuedAtMs);
    void this.executeNow(next.method, next.params, next.context)
      .then((value) => next.resolve(value))
      .catch((error) => next.reject(error))
      .finally(() => {
        if (this.inFlight < this.maxInFlight && this.queue.length > 0) {
          this.drainQueue();
        }
      });
  }

  private recordQueueWait(waitMs: number): void {
    if (!Number.isFinite(waitMs) || waitMs < 0) return;
    this.queueWaitSamplesMs.push(waitMs);
    if (this.queueWaitSamplesMs.length > 256) {
      this.queueWaitSamplesMs.splice(0, this.queueWaitSamplesMs.length - 256);
    }
  }

  private queueWaitMsP95(): number {
    if (this.queueWaitSamplesMs.length === 0) return 0;
    const sorted = [...this.queueWaitSamplesMs].sort((a, b) => a - b);
    const index = Math.max(
      0,
      Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)),
    );
    return Math.floor(sorted[index] ?? 0);
  }
}

export function parseIncomingFrame(message: unknown): {
  frame?: GatewayIncomingFrame;
  error?: string;
} {
  let payload: unknown = message;
  if (typeof message === 'string') {
    const raw = message.trim();
    if (!raw) return { error: 'empty_message' };
    if (raw === 'status') {
      payload = { type: 'request', id: 'legacy-status', method: 'gateway.status.get', params: {} };
    } else {
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        return { error: 'invalid_json' };
      }
    }
  }

  try {
    const frame = GatewayIncomingFrameSchema.parse(payload);
    return { frame };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid_frame' };
  }
}

export function toResponseFrame(input: {
  id: string;
  ok: boolean;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: unknown;
}): ResponseFrame {
  const result = toJsonCompatible(input.result);
  const errorDetails = toJsonCompatible(input.errorDetails);
  if (input.ok) {
    return ResponseFrameSchema.parse({
      type: 'response',
      id: input.id,
      ok: true,
      result,
    });
  }
  return ResponseFrameSchema.parse({
    type: 'response',
    id: input.id,
    ok: false,
    error: {
      code: input.errorCode ?? 'internal_error',
      message: input.errorMessage ?? 'Internal error',
      details: errorDetails,
    },
  });
}

export function toEventFrame(input: {
  event: string;
  payload: unknown;
  stateVersion?: Record<string, number>;
}): EventFrame {
  const payload = toJsonCompatible(input.payload);
  return EventFrameSchema.parse({
    type: 'event',
    event: input.event,
    payload,
    stateVersion: input.stateVersion,
  });
}

export function toPongFrame(ts: number): PongFrame {
  return PongFrameSchema.parse({
    type: 'pong',
    ts,
  });
}

function toJsonCompatible(input: unknown): unknown {
  if (input === undefined) return null;
  if (input === null) return null;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => toJsonCompatible(item));
  }
  if (typeof input === 'object') {
    const source = input as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      next[key] = toJsonCompatible(value);
    }
    return next;
  }
  return String(input);
}
