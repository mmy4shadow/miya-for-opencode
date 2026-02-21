import { z } from 'zod';

const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);

const JsonObject = z.record(z.string(), JsonValue);

export const DaemonHelloFrameSchema = z.object({
  type: z.literal('hello'),
  clientID: z.string().min(1).max(120).optional(),
  role: z.enum(['plugin', 'ui', 'unknown']).default('plugin'),
  protocolVersion: z.string().default('1.0'),
  auth: z
    .object({
      token: z.string().min(1),
    })
    .optional(),
});

export const DaemonRequestFrameSchema = z.object({
  type: z.literal('request'),
  id: z.string().min(1),
  method: z.string().min(1),
  params: JsonObject.default({}),
});

export const DaemonResponseFrameSchema = z.object({
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

export const DaemonEventFrameSchema = z.object({
  type: z.literal('event'),
  event: z.string().min(1),
  payload: JsonValue,
});

export const DaemonPingFrameSchema = z.object({
  type: z.literal('ping'),
  ts: z.number().int().nonnegative(),
});

export const DaemonPongFrameSchema = z.object({
  type: z.literal('pong'),
  ts: z.number().int().nonnegative(),
});

export const DaemonIncomingFrameSchema = z.union([
  DaemonHelloFrameSchema,
  DaemonRequestFrameSchema,
  DaemonPingFrameSchema,
]);

export const DaemonOutgoingFrameSchema = z.union([
  DaemonResponseFrameSchema,
  DaemonEventFrameSchema,
  DaemonPongFrameSchema,
]);

export type DaemonHelloFrame = z.infer<typeof DaemonHelloFrameSchema>;
export type DaemonRequestFrame = z.infer<typeof DaemonRequestFrameSchema>;
export type DaemonResponseFrame = z.infer<typeof DaemonResponseFrameSchema>;
export type DaemonEventFrame = z.infer<typeof DaemonEventFrameSchema>;
export type DaemonPingFrame = z.infer<typeof DaemonPingFrameSchema>;
export type DaemonPongFrame = z.infer<typeof DaemonPongFrameSchema>;
export type DaemonIncomingFrame = z.infer<typeof DaemonIncomingFrameSchema>;
export type DaemonOutgoingFrame = z.infer<typeof DaemonOutgoingFrameSchema>;

export function parseDaemonIncomingFrame(input: unknown): {
  frame?: DaemonIncomingFrame;
  error?: string;
} {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    const frame = DaemonIncomingFrameSchema.parse(value);
    return { frame };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid_frame' };
  }
}

export function parseDaemonOutgoingFrame(input: unknown): {
  frame?: DaemonOutgoingFrame;
  error?: string;
} {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    const frame = DaemonOutgoingFrameSchema.parse(value);
    return { frame };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid_frame' };
  }
}
