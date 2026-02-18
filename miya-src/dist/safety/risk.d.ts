import type { SafetyTier } from './tier';
export interface SafetyPermissionRequest {
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata?: Record<string, unknown>;
    toolCallID?: string;
    messageID?: string;
}
export declare function isSideEffectPermission(permission: string): boolean;
export declare function requiredTierForRequest(request: Pick<SafetyPermissionRequest, 'permission' | 'patterns'>): SafetyTier;
export declare function buildRequestHash(request: Pick<SafetyPermissionRequest, 'permission' | 'patterns' | 'toolCallID' | 'messageID'>, includeMessageContext?: boolean): string;
