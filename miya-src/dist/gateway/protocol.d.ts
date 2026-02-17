import { z } from 'zod';
export type GatewayClientRole = 'ui' | 'admin' | 'node' | 'channel' | 'unknown';
export declare const GATEWAY_PROTOCOL_VERSION = "1.1";
export declare const LEGACY_GATEWAY_PROTOCOL_VERSION = "1.0";
export declare const SUPPORTED_GATEWAY_PROTOCOL_VERSIONS: readonly ["1.0", "1.1"];
export declare const PlanBundleAuditEventSchema: z.ZodObject<{
    id: z.ZodString;
    at: z.ZodString;
    stage: z.ZodEnum<{
        approval: "approval";
        rollback: "rollback";
        audit: "audit";
        execution: "execution";
        plan: "plan";
        finalize: "finalize";
    }>;
    action: z.ZodString;
    inputSummary: z.ZodString;
    inputHash: z.ZodString;
    approvalBasis: z.ZodString;
    resultHash: z.ZodString;
    replayToken: z.ZodString;
}, z.core.$strip>;
export declare const PlanBundleApprovalSchema: z.ZodObject<{
    required: z.ZodBoolean;
    approved: z.ZodBoolean;
    approver: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    policyHash: z.ZodOptional<z.ZodString>;
    requestedAt: z.ZodOptional<z.ZodString>;
    approvedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PlanBundleRollbackSchema: z.ZodObject<{
    command: z.ZodOptional<z.ZodString>;
    attempted: z.ZodBoolean;
    ok: z.ZodOptional<z.ZodBoolean>;
    exitCode: z.ZodOptional<z.ZodNumber>;
    result: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PlanBundleSchema: z.ZodObject<{
    bundleId: z.ZodString;
    id: z.ZodString;
    version: z.ZodLiteral<"1.0">;
    goal: z.ZodString;
    mode: z.ZodEnum<{
        work: "work";
        chat: "chat";
        mixed: "mixed";
        subagent: "subagent";
    }>;
    riskTier: z.ZodEnum<{
        LIGHT: "LIGHT";
        STANDARD: "STANDARD";
        THOROUGH: "THOROUGH";
    }>;
    lifecycleState: z.ZodEnum<{
        done: "done";
        approved: "approved";
        failed: "failed";
        draft: "draft";
        proposed: "proposed";
        executing: "executing";
        verifying: "verifying";
        postmortem: "postmortem";
    }>;
    budget: z.ZodObject<{
        timeMs: z.ZodNumber;
        costUsd: z.ZodNumber;
        retries: z.ZodNumber;
    }, z.core.$strip>;
    capabilitiesNeeded: z.ZodArray<z.ZodString>;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        intent: z.ZodString;
        tools: z.ZodArray<z.ZodString>;
        expectedArtifacts: z.ZodArray<z.ZodString>;
        rollback: z.ZodString;
        done: z.ZodBoolean;
        command: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    approvalPolicy: z.ZodObject<{
        required: z.ZodBoolean;
        mode: z.ZodEnum<{
            manual: "manual";
            auto: "auto";
        }>;
    }, z.core.$strip>;
    verificationPlan: z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
        checks: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
    policyHash: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    status: z.ZodEnum<{
        approved: "approved";
        failed: "failed";
        running: "running";
        completed: "completed";
        rolled_back: "rolled_back";
        draft: "draft";
        pending_approval: "pending_approval";
    }>;
    plan: z.ZodObject<{
        goal: z.ZodString;
        createdAt: z.ZodString;
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            kind: z.ZodEnum<{
                execution: "execution";
                verification: "verification";
                analysis: "analysis";
            }>;
            command: z.ZodOptional<z.ZodString>;
            done: z.ZodBoolean;
            note: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    approval: z.ZodObject<{
        required: z.ZodBoolean;
        approved: z.ZodBoolean;
        approver: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
        policyHash: z.ZodOptional<z.ZodString>;
        requestedAt: z.ZodOptional<z.ZodString>;
        approvedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    execution: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    verification: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    rollback: z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
        attempted: z.ZodBoolean;
        ok: z.ZodOptional<z.ZodBoolean>;
        exitCode: z.ZodOptional<z.ZodNumber>;
        result: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    audit: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        at: z.ZodString;
        stage: z.ZodEnum<{
            approval: "approval";
            rollback: "rollback";
            audit: "audit";
            execution: "execution";
            plan: "plan";
            finalize: "finalize";
        }>;
        action: z.ZodString;
        inputSummary: z.ZodString;
        inputHash: z.ZodString;
        approvalBasis: z.ZodString;
        resultHash: z.ZodString;
        replayToken: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
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
        challenge: z.ZodOptional<z.ZodObject<{
            nonce: z.ZodString;
            ts: z.ZodNumber;
            signature: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const RequestFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"request">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
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
export type PlanBundleAuditEventFrame = z.infer<typeof PlanBundleAuditEventSchema>;
export type PlanBundleApprovalFrame = z.infer<typeof PlanBundleApprovalSchema>;
export type PlanBundleRollbackFrame = z.infer<typeof PlanBundleRollbackSchema>;
export type PlanBundleFrame = z.infer<typeof PlanBundleSchema>;
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
        challenge: z.ZodOptional<z.ZodObject<{
            nonce: z.ZodString;
            ts: z.ZodNumber;
            signature: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"request">;
    id: z.ZodString;
    method: z.ZodString;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>>;
    idempotencyKey: z.ZodOptional<z.ZodString>;
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
