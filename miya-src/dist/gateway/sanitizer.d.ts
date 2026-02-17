export type ContextMode = 'work' | 'chat';
export type GatewayMode = ContextMode | 'mixed';
export interface SanitizedGatewayContext {
    mode: GatewayMode;
    payload: string;
    removedSignals: string[];
}
export declare function inferContextMode(text: string): ContextMode;
export declare function sanitizeGatewayContext(input: {
    text: string;
    modeHint?: GatewayMode;
}): SanitizedGatewayContext;
