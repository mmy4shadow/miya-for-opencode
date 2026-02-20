export declare const REQUIRED_HOOK_KEYS: readonly ["tool.execute.before", "tool.execute.after", "permission.ask"];
type RequiredHookKey = (typeof REQUIRED_HOOK_KEYS)[number];
export declare function assertRequiredHookHandlers(hooks: Partial<Record<RequiredHookKey, unknown>>): void;
export {};
