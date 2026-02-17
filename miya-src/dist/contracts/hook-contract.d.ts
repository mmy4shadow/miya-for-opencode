export declare const REQUIRED_HOOK_KEYS: readonly ["tool.execute.before", "tool.execute.after", "permission.ask"];
export declare const PERMISSION_HOOK_COMPAT: {
    readonly observedHook: "permission.ask";
    readonly canonicalAsked: "permission.asked";
    readonly canonicalReplied: "permission.replied";
};
type RequiredHookKey = (typeof REQUIRED_HOOK_KEYS)[number];
export declare function assertRequiredHookHandlers(hooks: Partial<Record<RequiredHookKey, unknown>>): void;
export {};
