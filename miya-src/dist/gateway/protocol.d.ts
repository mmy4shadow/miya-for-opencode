export type GatewayClientRole = 'ui' | 'admin' | 'node' | 'channel' | 'unknown';
export interface HelloFrame {
    type: 'hello';
    role?: GatewayClientRole;
    clientID?: string;
    protocolVersion?: string;
    auth?: {
        token?: string;
    };
    capabilities?: string[];
}
export interface RequestFrame {
    type: 'request';
    id: string;
    method: string;
    params?: Record<string, unknown>;
}
export interface ResponseFrame {
    type: 'response';
    id: string;
    ok: boolean;
    result?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}
export interface EventFrame {
    type: 'event';
    event: string;
    payload: unknown;
    stateVersion?: Record<string, number>;
}
export type GatewayIncomingFrame = HelloFrame | RequestFrame;
export interface GatewayMethodContext {
    clientID: string;
    role: GatewayClientRole;
}
export type GatewayMethodHandler = (params: Record<string, unknown>, context: GatewayMethodContext) => Promise<unknown> | unknown;
export declare class GatewayMethodRegistry {
    private handlers;
    register(method: string, handler: GatewayMethodHandler): void;
    invoke(method: string, params: Record<string, unknown>, context: GatewayMethodContext): Promise<unknown>;
    list(): string[];
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
