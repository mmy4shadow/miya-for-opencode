import { z } from 'zod';
export declare const DaemonHelloFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"hello">;
    clientID: z.ZodOptional<z.ZodString>;
    role: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        ui: "ui";
        plugin: "plugin";
    }>>;
    protocolVersion: z.ZodDefault<z.ZodString>;
    auth: z.ZodOptional<z.ZodObject<{
        token: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const DaemonRequestFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"request">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
}, z.core.$strip>;
export declare const DaemonResponseFrameSchema: z.ZodObject<{
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
export declare const DaemonEventFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"event">;
    event: z.ZodString;
    payload: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
}, z.core.$strip>;
export declare const DaemonPingFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    ts: z.ZodNumber;
}, z.core.$strip>;
export declare const DaemonPongFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    ts: z.ZodNumber;
}, z.core.$strip>;
export declare const DaemonIncomingFrameSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"hello">;
    clientID: z.ZodOptional<z.ZodString>;
    role: z.ZodDefault<z.ZodEnum<{
        unknown: "unknown";
        ui: "ui";
        plugin: "plugin";
    }>>;
    protocolVersion: z.ZodDefault<z.ZodString>;
    auth: z.ZodOptional<z.ZodObject<{
        token: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"request">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    ts: z.ZodNumber;
}, z.core.$strip>]>;
export declare const DaemonOutgoingFrameSchema: z.ZodUnion<readonly [z.ZodObject<{
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
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    ts: z.ZodNumber;
}, z.core.$strip>]>;
export type DaemonHelloFrame = z.infer<typeof DaemonHelloFrameSchema>;
export type DaemonRequestFrame = z.infer<typeof DaemonRequestFrameSchema>;
export type DaemonResponseFrame = z.infer<typeof DaemonResponseFrameSchema>;
export type DaemonEventFrame = z.infer<typeof DaemonEventFrameSchema>;
export type DaemonPingFrame = z.infer<typeof DaemonPingFrameSchema>;
export type DaemonPongFrame = z.infer<typeof DaemonPongFrameSchema>;
export type DaemonIncomingFrame = z.infer<typeof DaemonIncomingFrameSchema>;
export type DaemonOutgoingFrame = z.infer<typeof DaemonOutgoingFrameSchema>;
export declare function parseDaemonIncomingFrame(input: unknown): {
    frame?: DaemonIncomingFrame;
    error?: string;
};
export declare function parseDaemonOutgoingFrame(input: unknown): {
    frame?: DaemonOutgoingFrame;
    error?: string;
};
