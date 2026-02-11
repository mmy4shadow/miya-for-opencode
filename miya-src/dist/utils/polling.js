import { MAX_POLL_TIME_MS, POLL_INTERVAL_MS, STABLE_POLLS_THRESHOLD, } from '../config';
/**
 * Generic polling utility that waits for a condition to be met.
 * Returns when the condition is satisfied or timeout/abort occurs.
 */
export async function pollUntilStable(fetchFn, isStable, opts = {}) {
    const pollInterval = opts.pollInterval ?? POLL_INTERVAL_MS;
    const maxPollTime = opts.maxPollTime ?? MAX_POLL_TIME_MS;
    const stableThreshold = opts.stableThreshold ?? STABLE_POLLS_THRESHOLD;
    const pollStart = Date.now();
    let previousData = null;
    let stablePolls = 0;
    while (Date.now() - pollStart < maxPollTime) {
        if (opts.signal?.aborted) {
            return { success: false, aborted: true };
        }
        await new Promise((r) => setTimeout(r, pollInterval));
        const currentData = await fetchFn();
        if (isStable(currentData, previousData, stablePolls)) {
            stablePolls++;
            if (stablePolls >= stableThreshold) {
                return { success: true, data: currentData };
            }
        }
        else {
            stablePolls = 0;
        }
        previousData = currentData;
    }
    return { success: false, timedOut: true, data: previousData ?? undefined };
}
/**
 * Simple delay utility
 */
export function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
