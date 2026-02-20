import { z } from 'zod';
export type GatewayClientRole = 'ui' | 'admin' | 'node' | 'channel' | 'unknown';
export declare const HelloFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"hello">;
    role: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        ui: "ui";
        channel: "channel";
        node: "node";
        admin: "admin";
    }>>;
    clientID: z.ZodOptional<z.ZodString>;
    protocolVersion: z.ZodOptional<z.ZodString>;
    auth: z.ZodOptional<z.ZodObject<{
        token: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const RequestFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"request">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
}, z.core.$strip>;
export declare const PingFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    ts: z.ZodNumber;
}, z.core.$strip>;
export declare const PongFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    ts: z.ZodNumber;
}, z.core.$strip>;
export declare const ResponseFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"response">;
    id: z.ZodString;
    ok: z.ZodBoolean;
    result: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const EventFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"event">;
    event: z.ZodString;
    payload: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    stateVersion: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, z.core.$strip>;
export type HelloFrame = z.infer<typeof HelloFrameSchema>;
export type RequestFrame = z.infer<typeof RequestFrameSchema>;
export type ResponseFrame = z.infer<typeof ResponseFrameSchema>;
export type EventFrame = z.infer<typeof EventFrameSchema>;
export type PingFrame = z.infer<typeof PingFrameSchema>;
export type PongFrame = z.infer<typeof PongFrameSchema>;
export declare const GatewayIncomingFrameSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"hello">;
    role: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        ui: "ui";
        channel: "channel";
        node: "node";
        admin: "admin";
    }>>;
    clientID: z.ZodOptional<z.ZodString>;
    protocolVersion: z.ZodOptional<z.ZodString>;
    auth: z.ZodOptional<z.ZodObject<{
        token: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"request">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    ts: z.ZodNumber;
}, z.core.$strip>]>;
export declare const GatewayOutgoingFrameSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"response">;
    id: z.ZodString;
    ok: z.ZodBoolean;
    result: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"event">;
    event: z.ZodString;
    payload: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    stateVersion: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    ts: z.ZodNumber;
}, z.core.$strip>]>;
export type GatewayIncomingFrame = z.infer<typeof GatewayIncomingFrameSchema>;
export type GatewayOutgoingFrame = z.infer<typeof GatewayOutgoingFrameSchema>;
export interface GatewayMethodContext {
    clientID: string;
    role: GatewayClientRole;
}
export type GatewayMethodHandler = (params: Record<string, unknown>, context: GatewayMethodContext) => Promise<unknown> | unknown;
interface GatewayMethodRegistryOptions {
    maxInFlight?: number;
    maxQueued?: number;
    queueTimeoutMs?: number;
}
export declare class GatewayMethodRegistry {
    private handlers;
    private inFlight;
    private readonly queue;
    private rejectedOverloaded;
    private rejectedTimeout;
    private readonly queueWaitSamplesMs;
    private readonly maxInFlight;
    private readonly maxQueued;
    private readonly queueTimeoutMs;
    constructor(options?: GatewayMethodRegistryOptions);
    register(method: string, handler: GatewayMethodHandler): void;
    invoke(method: string, params: Record<string, unknown>, context: GatewayMethodContext): Promise<unknown>;
    list(): string[];
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
    };
    private executeNow;
    private drainQueue;
    private recordQueueWait;
    private queueWaitMsP95;
}
export declare function parseIncomingFrame(message: unknown): {
    frame?: GatewayIncomingFrame;
    error?: string;
};
export declare function toResponseFrame(input: {
    id: string;
    ok: boolean;
    result?: unknown;
    errorCode?: string;
    errorMessage?: string;
    errorDetails?: unknown;
}): ResponseFrame;
export declare function toEventFrame(input: {
    event: string;
    payload: unknown;
    stateVersion?: Record<string, number>;
}): EventFrame;
export declare function toPongFrame(ts: number): PongFrame;
export {};
