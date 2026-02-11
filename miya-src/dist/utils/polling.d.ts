export interface PollOptions {
    pollInterval?: number;
    maxPollTime?: number;
    stableThreshold?: number;
    signal?: AbortSignal;
}
export interface PollResult<T> {
    success: boolean;
    data?: T;
    timedOut?: boolean;
    aborted?: boolean;
}
/**
 * Generic polling utility that waits for a condition to be met.
 * Returns when the condition is satisfied or timeout/abort occurs.
 */
export declare function pollUntilStable<T>(fetchFn: () => Promise<T>, isStable: (current: T, previous: T | null, stableCount: number) => boolean, opts?: PollOptions): Promise<PollResult<T>>;
/**
 * Simple delay utility
 */
export declare function delay(ms: number): Promise<void>;
