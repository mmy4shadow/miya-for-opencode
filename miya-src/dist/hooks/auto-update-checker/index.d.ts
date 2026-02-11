import type { PluginInput } from '@opencode-ai/plugin';
import type { AutoUpdateCheckerOptions } from './types';
/**
 * Creates an OpenCode hook that checks for plugin updates when a new session is created.
 * @param ctx The plugin input context.
 * @param options Configuration options for the update checker.
 * @returns A hook object for the session.created event.
 */
export declare function createAutoUpdateCheckerHook(ctx: PluginInput, options?: AutoUpdateCheckerOptions): {
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => void;
};
export type { AutoUpdateCheckerOptions } from './types';
