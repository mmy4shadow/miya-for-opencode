export interface SafeIntervalOptions {
    cooldownMs?: number;
    maxConsecutiveErrors?: number;
    onError?: (input: {
        taskName: string;
        error: unknown;
        consecutiveErrors: number;
        cooldownUntilMs?: number;
    }) => void;
}
export declare function safeInterval(taskName: string, intervalMs: number, run: () => void | Promise<void>, options?: SafeIntervalOptions): ReturnType<typeof setInterval>;
