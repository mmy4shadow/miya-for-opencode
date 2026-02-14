import { z } from 'zod';

export type GatewayClientRole = 'ui' | 'admin' | 'node' | 'channel' | 'unknown';

const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(z.string(), JsonValue)]),
);

const JsonObject = z.record(z.string(), JsonValue);

export const HelloFrameSchema = z.object({
  type: z.literal('hello'),
  role: z.enum(['ui', 'admin', 'node', 'channel', 'unknown']).default('unknown'),
  clientID: z.string().optional(),
  protocolVersion: z.string().optional(),
  auth: z
    .object({
      token: z.string().optional(),
    })
    .optional(),
  capabilities: z.array(z.string()).optional(),
});

export const RequestFrameSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.string().min(1),
  params: JsonObject.default({}),
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
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class GatewayMethodRegistry {
  private handlers = new Map<string, GatewayMethodHandler>();
  private inFlight = 0;
  private readonly queue: QueuedInvocation[] = [];
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

  async invoke(
    method: string,
    params: Record<string, unknown>,
    context: GatewayMethodContext,
  ): Promise<unknown> {
    if (this.inFlight < this.maxInFlight) {
      return this.executeNow(method, params, context);
    }
    if (this.queue.length >= this.maxQueued) {
      throw new Error(
        `gateway_backpressure_overloaded:in_flight=${this.inFlight}:queued=${this.queue.length}`,
      );
    }
    return await new Promise<unknown>((resolve, reject) => {
      const queued: QueuedInvocation = {
        method,
        params,
        context,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = this.queue.indexOf(queued);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new Error('gateway_backpressure_timeout'));
        }, this.queueTimeoutMs),
      };
      this.queue.push(queued);
    });
  }

  list(): string[] {
    return [...this.handlers.keys()].sort();
  }

  stats(): { inFlight: number; queued: number; maxInFlight: number; maxQueued: number } {
    return {
      inFlight: this.inFlight,
      queued: this.queue.length,
      maxInFlight: this.maxInFlight,
      maxQueued: this.maxQueued,
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
    void this.executeNow(next.method, next.params, next.context)
      .then((value) => next.resolve(value))
      .catch((error) => next.reject(error))
      .finally(() => {
        if (this.inFlight < this.maxInFlight && this.queue.length > 0) {
          this.drainQueue();
        }
      });
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
  if (input.ok) {
    return ResponseFrameSchema.parse({
      type: 'response',
      id: input.id,
      ok: true,
      result: input.result,
    });
  }
  return ResponseFrameSchema.parse({
    type: 'response',
    id: input.id,
    ok: false,
    error: {
      code: input.errorCode ?? 'internal_error',
      message: input.errorMessage ?? 'Internal error',
      details: input.errorDetails,
    },
  });
}

export function toEventFrame(input: {
  event: string;
  payload: unknown;
  stateVersion?: Record<string, number>;
}): EventFrame {
  return EventFrameSchema.parse({
    type: 'event',
    event: input.event,
    payload: input.payload,
    stateVersion: input.stateVersion,
  });
}

export function toPongFrame(ts: number): PongFrame {
  return PongFrameSchema.parse({
    type: 'pong',
    ts,
  });
}
