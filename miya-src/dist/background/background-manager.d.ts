/**
 * Background Task Manager
 *
 * Manages long-running AI agent tasks that execute in separate sessions.
 * Background tasks run independently from the main conversation flow, allowing
 * the user to continue working while tasks complete asynchronously.
 *
 * Key features:
 * - Fire-and-forget launch (returns task_id immediately)
 * - Creates isolated sessions for background work
 * - Event-driven completion detection via session.status
 * - Start queue with configurable concurrency limit
 * - Supports task cancellation and result retrieval
 */
import type { PluginInput } from '@opencode-ai/plugin';
import type { BackgroundTaskConfig, PluginConfig } from '../config';
import type { TmuxConfig } from '../config/schema';
/**
 * Represents a background task running in an isolated session.
 * Tasks are tracked from creation through completion or failure.
 */
export interface BackgroundTask {
    id: string;
    sessionId?: string;
    description: string;
    agent: string;
    status: 'pending' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
    result?: string;
    error?: string;
    config: BackgroundTaskConfig;
    parentSessionId: string;
    startedAt: Date;
    completedAt?: Date;
    prompt: string;
}
/**
 * Options for launching a new background task.
 */
export interface LaunchOptions {
    agent: string;
    prompt: string;
    description: string;
    parentSessionId: string;
}
export declare class BackgroundTaskManager {
    private tasks;
    private tasksBySessionId;
    private agentBySessionId;
    private client;
    private directory;
    private tmuxEnabled;
    private config?;
    private backgroundConfig;
    private startQueue;
    private activeStarts;
    private maxConcurrentStarts;
    private completionResolvers;
    constructor(ctx: PluginInput, tmuxConfig?: TmuxConfig, config?: PluginConfig);
    /**
     * Look up the delegation rules for an agent type.
     * Unknown agent types default to explorer-only access, making it easy
     * to add new background agent types without updating SUBAGENT_DELEGATION_RULES.
     */
    private getSubagentRules;
    /**
     * Check if a parent session is allowed to delegate to a specific agent type.
     * @param parentSessionId - The session ID of the parent
     * @param requestedAgent - The agent type being requested
     * @returns true if allowed, false if not
     */
    isAgentAllowed(parentSessionId: string, requestedAgent: string): boolean;
    /**
     * Get the list of allowed subagents for a parent session.
     * @param parentSessionId - The session ID of the parent
     * @returns Array of allowed agent names, empty if none
     */
    getAllowedSubagents(parentSessionId: string): readonly string[];
    /**
     * Launch a new background task (fire-and-forget).
     *
     * Phase A (sync): Creates task record and returns immediately.
     * Phase B (async): Session creation and prompt sending happen in background.
     *
     * @param opts - Task configuration options
     * @returns The created background task with pending status
     */
    launch(opts: LaunchOptions): BackgroundTask;
    /**
     * Enqueue task for background start.
     */
    private enqueueStart;
    /**
     * Process start queue with concurrency limit.
     */
    private processQueue;
    private resolveFallbackChain;
    private promptWithTimeout;
    /**
     * Calculate tool permissions for a spawned agent based on its own delegation rules.
     * Agents that cannot delegate (leaf nodes) get delegation tools disabled entirely,
     * preventing models from even seeing tools they can never use.
     *
     * @param agentName - The agent type being spawned
     * @returns Tool permissions object with background_task and task enabled/disabled
     */
    private calculateToolPermissions;
    /**
     * Start a task in the background (Phase B).
     */
    private startTask;
    /**
     * Handle session.status events for completion detection.
     * Uses session.status instead of deprecated session.idle.
     */
    handleSessionStatus(event: {
        type: string;
        properties?: {
            sessionID?: string;
            status?: {
                type: string;
            };
        };
    }): Promise<void>;
    /**
     * Extract task result and mark complete.
     */
    private extractAndCompleteTask;
    /**
     * Complete a task and notify waiting callers.
     */
    private completeTask;
    /**
     * Send completion notification to parent session.
     */
    private sendCompletionNotification;
    /**
     * Retrieve the current state of a background task.
     *
     * @param taskId - The task ID to retrieve
     * @returns The task object, or null if not found
     */
    getResult(taskId: string): BackgroundTask | null;
    /**
     * Wait for a task to complete.
     *
     * @param taskId - The task ID to wait for
     * @param timeout - Maximum time to wait in milliseconds (0 = no timeout)
     * @returns The completed task, or null if not found/timeout
     */
    waitForCompletion(taskId: string, timeout?: number): Promise<BackgroundTask | null>;
    /**
     * Cancel one or all running background tasks.
     *
     * @param taskId - Optional task ID to cancel. If omitted, cancels all pending/running tasks.
     * @returns Number of tasks cancelled
     */
    cancel(taskId?: string): number;
    /**
     * Clean up all tasks.
     */
    cleanup(): void;
}
