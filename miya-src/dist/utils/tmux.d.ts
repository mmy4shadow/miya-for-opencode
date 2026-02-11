import type { TmuxConfig } from '../config/schema';
/**
 * Reset the server availability cache (useful when server might have started)
 */
export declare function resetServerCheck(): void;
/**
 * Get cached tmux path, initializing if needed
 */
export declare function getTmuxPath(): Promise<string | null>;
/**
 * Check if we're running inside tmux
 */
export declare function isInsideTmux(): boolean;
export interface SpawnPaneResult {
    success: boolean;
    paneId?: string;
}
/**
 * Spawn a new tmux pane running `opencode attach <serverUrl> --session <sessionId>`
 * This connects the new TUI to the existing server so it receives streaming updates.
 * After spawning, applies the configured layout to auto-rebalance all panes.
 * Returns the pane ID so it can be closed later.
 */
export declare function spawnTmuxPane(sessionId: string, description: string, config: TmuxConfig, serverUrl: string): Promise<SpawnPaneResult>;
/**
 * Close a tmux pane by its ID and reapply layout to rebalance remaining panes
 */
export declare function closeTmuxPane(paneId: string): Promise<boolean>;
/**
 * Start background check for tmux availability
 */
export declare function startTmuxCheck(): void;
