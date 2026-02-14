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

export class GatewayMethodRegistry {
  private handlers = new Map<string, GatewayMethodHandler>();

  register(method: string, handler: GatewayMethodHandler): void {
    this.handlers.set(method, handler);
  }

  async invoke(
    method: string,
    params: Record<string, unknown>,
    context: GatewayMethodContext,
  ): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) throw new Error(`unknown_method:${method}`);
    return await handler(params, context);
  }

  list(): string[] {
    return [...this.handlers.keys()].sort();
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

