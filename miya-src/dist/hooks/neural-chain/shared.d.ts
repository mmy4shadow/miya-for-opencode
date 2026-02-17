import type { GatewayMode } from '../../gateway/sanitizer';
export interface MessageInfo {
    role: string;
    agent?: string;
    sessionID?: string;
}
export interface MessagePart {
    type: string;
    text?: string;
}
export interface MessageWithParts {
    info: MessageInfo;
    parts: MessagePart[];
}
export interface LastUserTextPart {
    message: MessageWithParts;
    partIndex: number;
    sessionID: string;
}
export interface ParsedModeKernelMeta {
    mode: GatewayMode;
    confidence: number;
    why: string[];
}
export declare function normalizeSessionID(sessionID?: string): string;
export declare function findLastUserTextPart(messages: MessageWithParts[]): LastUserTextPart | null;
export declare function isCommandBridgeText(text: string): boolean;
export declare function hasBlock(text: string, marker: string): boolean;
export declare function prependBlock(block: string, text: string): string;
export declare function extractUserIntentText(text: string): string;
export declare function parseModeKernelMeta(text: string): ParsedModeKernelMeta | null;
