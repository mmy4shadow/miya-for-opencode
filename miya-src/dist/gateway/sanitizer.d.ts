export type ContextMode = 'work' | 'chat';
export interface SanitizedGatewayContext {
    mode: ContextMode;
    payload: string;
    removedSignals: string[];
}
export declare function inferContextMode(text: string): ContextMode;
export declare function sanitizeGatewayContext(input: {
    text: string;
    modeHint?: ContextMode;
}): SanitizedGatewayContext;
