import type { PluginInput } from '@opencode-ai/plugin';
import type { TmuxConfig } from '../config/schema';
/**
 * Event shape for session events
 */
interface SessionEvent {
    type: string;
    properties?: {
        info?: {
            id?: string;
            parentID?: string;
            title?: string;
        };
        sessionID?: string;
        status?: {
            type: string;
        };
    };
}
/**
 * TmuxSessionManager tracks child sessions and spawns/closes tmux panes for them.
 *
 * Uses session.status events for completion detection instead of polling.
 */
export declare class TmuxSessionManager {
    private client;
    private tmuxConfig;
    private serverUrl;
    private sessions;
    private pollInterval?;
    private enabled;
    constructor(ctx: PluginInput, tmuxConfig: TmuxConfig);
    /**
     * Handle session.created events.
     * Spawns a tmux pane for child sessions (those with parentID).
     */
    onSessionCreated(event: SessionEvent): Promise<void>;
    /**
     * Handle session.status events for completion detection.
     * Uses session.status instead of deprecated session.idle.
     *
     * When a session becomes idle (completed), close its pane.
     */
    onSessionStatus(event: SessionEvent): Promise<void>;
    /**
     * Handle session.deleted events.
     * When a session is deleted, close its tmux pane immediately.
     */
    onSessionDeleted(event: SessionEvent): Promise<void>;
    private startPolling;
    private stopPolling;
    /**
     * Poll sessions for status updates (fallback for reliability).
     * Also handles timeout and missing session detection.
     */
    private pollSessions;
    private closeSession;
    /**
     * Clean up all tracked sessions.
     */
    cleanup(): Promise<void>;
}
export {};
