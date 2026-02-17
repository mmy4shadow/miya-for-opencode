export declare const PERMISSION_OBSERVED_HOOK: "permission.ask";
export declare const PERMISSION_CANONICAL_EVENTS: {
    readonly asked: "permission.asked";
    readonly replied: "permission.replied";
};
export interface PermissionObservedInput {
    sessionID?: string;
    type?: string;
    pattern?: string[] | string;
    metadata?: unknown;
    messageID?: string;
    callID?: string;
}
export interface PermissionObservedOutput {
    status?: 'allow' | 'ask' | 'deny';
}
export interface PermissionLifecycleEvent {
    event: typeof PERMISSION_CANONICAL_EVENTS.asked | typeof PERMISSION_CANONICAL_EVENTS.replied;
    at: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    messageID?: string;
    callID?: string;
    metadata?: unknown;
    status?: 'allow' | 'ask' | 'deny';
}
export declare function adaptPermissionLifecycle(input: PermissionObservedInput, output: PermissionObservedOutput): {
    asked: PermissionLifecycleEvent;
    replied: PermissionLifecycleEvent;
};
