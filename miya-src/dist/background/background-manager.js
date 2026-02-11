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
import { AGENT_ALIASES, FALLBACK_FAILOVER_TIMEOUT_MS, SUBAGENT_DELEGATION_RULES, } from '../config';
import { applyAgentVariant, resolveAgentVariant } from '../utils';
import { log } from '../utils/logger';
function parseModelReference(model) {
    const slashIndex = model.indexOf('/');
    if (slashIndex <= 0 || slashIndex >= model.length - 1) {
        return null;
    }
    return {
        providerID: model.slice(0, slashIndex),
        modelID: model.slice(slashIndex + 1),
    };
}
function generateTaskId() {
    return `bg_${Math.random().toString(36).substring(2, 10)}`;
}
export class BackgroundTaskManager {
    tasks = new Map();
    tasksBySessionId = new Map();
    // Track which agent type owns each session for delegation permission checks
    agentBySessionId = new Map();
    client;
    directory;
    tmuxEnabled;
    config;
    backgroundConfig;
    // Start queue
    startQueue = [];
    activeStarts = 0;
    maxConcurrentStarts;
    // Completion waiting
    completionResolvers = new Map();
    constructor(ctx, tmuxConfig, config) {
        this.client = ctx.client;
        this.directory = ctx.directory;
        this.tmuxEnabled = tmuxConfig?.enabled ?? false;
        this.config = config;
        this.backgroundConfig = config?.background ?? {
            maxConcurrentStarts: 10,
        };
        this.maxConcurrentStarts = this.backgroundConfig.maxConcurrentStarts;
    }
    /**
     * Look up the delegation rules for an agent type.
     * Unknown agent types default to explorer-only access, making it easy
     * to add new background agent types without updating SUBAGENT_DELEGATION_RULES.
     */
    getSubagentRules(agentName) {
        const normalizedAgentName = AGENT_ALIASES[agentName] ?? agentName;
        return (SUBAGENT_DELEGATION_RULES[normalizedAgentName] ?? ['2-code-search']);
    }
    /**
     * Check if a parent session is allowed to delegate to a specific agent type.
     * @param parentSessionId - The session ID of the parent
     * @param requestedAgent - The agent type being requested
     * @returns true if allowed, false if not
     */
    isAgentAllowed(parentSessionId, requestedAgent) {
        // Untracked sessions are the root orchestrator (created by OpenCode, not by us)
        const parentAgentName = this.agentBySessionId.get(parentSessionId) ?? '1-task-manager';
        const allowedSubagents = this.getSubagentRules(parentAgentName);
        if (allowedSubagents.length === 0)
            return false;
        return allowedSubagents.includes(requestedAgent);
    }
    /**
     * Get the list of allowed subagents for a parent session.
     * @param parentSessionId - The session ID of the parent
     * @returns Array of allowed agent names, empty if none
     */
    getAllowedSubagents(parentSessionId) {
        // Untracked sessions are the root orchestrator (created by OpenCode, not by us)
        const parentAgentName = this.agentBySessionId.get(parentSessionId) ?? '1-task-manager';
        return this.getSubagentRules(parentAgentName);
    }
    /**
     * Launch a new background task (fire-and-forget).
     *
     * Phase A (sync): Creates task record and returns immediately.
     * Phase B (async): Session creation and prompt sending happen in background.
     *
     * @param opts - Task configuration options
     * @returns The created background task with pending status
     */
    launch(opts) {
        const task = {
            id: generateTaskId(),
            sessionId: undefined,
            description: opts.description,
            agent: opts.agent,
            status: 'pending',
            startedAt: new Date(),
            config: {
                maxConcurrentStarts: this.maxConcurrentStarts,
            },
            parentSessionId: opts.parentSessionId,
            prompt: opts.prompt,
        };
        this.tasks.set(task.id, task);
        // Queue task for background start
        this.enqueueStart(task);
        log(`[background-manager] task launched: ${task.id}`, {
            agent: opts.agent,
            description: opts.description,
        });
        return task;
    }
    /**
     * Enqueue task for background start.
     */
    enqueueStart(task) {
        this.startQueue.push(task);
        this.processQueue();
    }
    /**
     * Process start queue with concurrency limit.
     */
    processQueue() {
        while (this.activeStarts < this.maxConcurrentStarts &&
            this.startQueue.length > 0) {
            const task = this.startQueue.shift();
            if (!task)
                break;
            this.startTask(task);
        }
    }
    resolveFallbackChain(agentName) {
        const fallback = this.config?.fallback;
        const chains = fallback?.chains;
        const legacyName = Object.keys(AGENT_ALIASES).find((key) => AGENT_ALIASES[key] === agentName);
        const configuredChain = chains?.[agentName] ?? (legacyName ? chains?.[legacyName] : []) ?? [];
        const primary = this.config?.agents?.[agentName]?.model ??
            (legacyName ? this.config?.agents?.[legacyName]?.model : undefined);
        const chain = [];
        const seen = new Set();
        for (const model of [primary, ...configuredChain]) {
            if (!model || seen.has(model))
                continue;
            seen.add(model);
            chain.push(model);
        }
        return chain;
    }
    async promptWithTimeout(args, timeoutMs) {
        await Promise.race([
            this.client.session.prompt(args),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Prompt timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }),
        ]);
    }
    /**
     * Calculate tool permissions for a spawned agent based on its own delegation rules.
     * Agents that cannot delegate (leaf nodes) get delegation tools disabled entirely,
     * preventing models from even seeing tools they can never use.
     *
     * @param agentName - The agent type being spawned
     * @returns Tool permissions object with background_task and task enabled/disabled
     */
    calculateToolPermissions(agentName) {
        const allowedSubagents = this.getSubagentRules(agentName);
        // Leaf agents (no delegation rules) get tools hidden entirely
        if (allowedSubagents.length === 0) {
            return { background_task: false, task: false };
        }
        // Agent can delegate - enable the delegation tools
        // The restriction of WHICH specific subagents are allowed is enforced
        // by the background_task tool via isAgentAllowed()
        return { background_task: true, task: true };
    }
    /**
     * Start a task in the background (Phase B).
     */
    async startTask(task) {
        task.status = 'starting';
        this.activeStarts++;
        // Check if cancelled after incrementing activeStarts (to catch race)
        // Use type assertion since cancel() can change status during race condition
        if (task.status === 'cancelled') {
            this.completeTask(task, 'cancelled', 'Task cancelled before start');
            return;
        }
        try {
            // Create session
            const session = await this.client.session.create({
                body: {
                    parentID: task.parentSessionId,
                    title: `Background: ${task.description}`,
                },
                query: { directory: this.directory },
            });
            if (!session.data?.id) {
                throw new Error('Failed to create background session');
            }
            task.sessionId = session.data.id;
            this.tasksBySessionId.set(session.data.id, task.id);
            // Track the agent type for this session for delegation checks
            this.agentBySessionId.set(session.data.id, task.agent);
            task.status = 'running';
            // Give TmuxSessionManager time to spawn the pane
            if (this.tmuxEnabled) {
                await new Promise((r) => setTimeout(r, 500));
            }
            // Calculate tool permissions based on the spawned agent's own delegation rules
            const toolPermissions = this.calculateToolPermissions(task.agent);
            // Send prompt
            const promptQuery = { directory: this.directory };
            const resolvedVariant = resolveAgentVariant(this.config, task.agent);
            const basePromptBody = applyAgentVariant(resolvedVariant, {
                agent: task.agent,
                tools: toolPermissions,
                parts: [{ type: 'text', text: task.prompt }],
            });
            const timeoutMs = this.config?.fallback?.timeoutMs ?? FALLBACK_FAILOVER_TIMEOUT_MS;
            const fallbackEnabled = this.config?.fallback?.enabled ?? true;
            const chain = fallbackEnabled
                ? this.resolveFallbackChain(task.agent)
                : [];
            const attemptModels = chain.length > 0 ? chain : [undefined];
            const errors = [];
            let succeeded = false;
            for (const model of attemptModels) {
                try {
                    const body = {
                        ...basePromptBody,
                        model: undefined,
                    };
                    if (model) {
                        const ref = parseModelReference(model);
                        if (!ref) {
                            throw new Error(`Invalid fallback model format: ${model}`);
                        }
                        body.model = ref;
                    }
                    await this.promptWithTimeout({
                        path: { id: session.data.id },
                        body,
                        query: promptQuery,
                    }, timeoutMs);
                    succeeded = true;
                    break;
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    if (model) {
                        errors.push(`${model}: ${msg}`);
                    }
                    else {
                        errors.push(`default-model: ${msg}`);
                    }
                }
            }
            if (!succeeded) {
                throw new Error(`All fallback models failed. ${errors.join(' | ')}`);
            }
            log(`[background-manager] task started: ${task.id}`, {
                sessionId: session.data.id,
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.completeTask(task, 'failed', errorMessage);
        }
        finally {
            this.activeStarts--;
            this.processQueue();
        }
    }
    /**
     * Handle session.status events for completion detection.
     * Uses session.status instead of deprecated session.idle.
     */
    async handleSessionStatus(event) {
        if (event.type !== 'session.status')
            return;
        const sessionId = event.properties?.sessionID;
        if (!sessionId)
            return;
        const taskId = this.tasksBySessionId.get(sessionId);
        if (!taskId)
            return;
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'running')
            return;
        // Check if session is idle (completed)
        if (event.properties?.status?.type === 'idle') {
            await this.extractAndCompleteTask(task);
        }
    }
    /**
     * Extract task result and mark complete.
     */
    async extractAndCompleteTask(task) {
        if (!task.sessionId)
            return;
        try {
            const messagesResult = await this.client.session.messages({
                path: { id: task.sessionId },
            });
            const messages = (messagesResult.data ?? []);
            const assistantMessages = messages.filter((m) => m.info?.role === 'assistant');
            const extractedContent = [];
            for (const message of assistantMessages) {
                for (const part of message.parts ?? []) {
                    if ((part.type === 'text' || part.type === 'reasoning') &&
                        part.text) {
                        extractedContent.push(part.text);
                    }
                }
            }
            const responseText = extractedContent
                .filter((t) => t.length > 0)
                .join('\n\n');
            if (responseText) {
                this.completeTask(task, 'completed', responseText);
            }
            else {
                this.completeTask(task, 'completed', '(No output)');
            }
        }
        catch (error) {
            this.completeTask(task, 'failed', error instanceof Error ? error.message : String(error));
        }
    }
    /**
     * Complete a task and notify waiting callers.
     */
    completeTask(task, status, resultOrError) {
        // Don't check for 'cancelled' here - cancel() may set status before calling
        if (task.status === 'completed' || task.status === 'failed') {
            return; // Already completed
        }
        task.status = status;
        task.completedAt = new Date();
        if (status === 'completed') {
            task.result = resultOrError;
        }
        else {
            task.error = resultOrError;
        }
        // Clean up session tracking maps to prevent memory leak
        if (task.sessionId) {
            this.tasksBySessionId.delete(task.sessionId);
            this.agentBySessionId.delete(task.sessionId);
        }
        // Send notification to parent session
        if (task.parentSessionId) {
            this.sendCompletionNotification(task).catch((err) => {
                log(`[background-manager] notification failed: ${err}`);
            });
        }
        // Resolve waiting callers
        const resolver = this.completionResolvers.get(task.id);
        if (resolver) {
            resolver(task);
            this.completionResolvers.delete(task.id);
        }
        log(`[background-manager] task ${status}: ${task.id}`, {
            description: task.description,
        });
    }
    /**
     * Send completion notification to parent session.
     */
    async sendCompletionNotification(task) {
        const message = task.status === 'completed'
            ? `[Background task "${task.description}" completed]`
            : `[Background task "${task.description}" failed: ${task.error}]`;
        await this.client.session.prompt({
            path: { id: task.parentSessionId },
            body: {
                parts: [{ type: 'text', text: message }],
            },
        });
    }
    /**
     * Retrieve the current state of a background task.
     *
     * @param taskId - The task ID to retrieve
     * @returns The task object, or null if not found
     */
    getResult(taskId) {
        return this.tasks.get(taskId) ?? null;
    }
    /**
     * Wait for a task to complete.
     *
     * @param taskId - The task ID to wait for
     * @param timeout - Maximum time to wait in milliseconds (0 = no timeout)
     * @returns The completed task, or null if not found/timeout
     */
    async waitForCompletion(taskId, timeout = 0) {
        const task = this.tasks.get(taskId);
        if (!task)
            return null;
        if (task.status === 'completed' ||
            task.status === 'failed' ||
            task.status === 'cancelled') {
            return task;
        }
        return new Promise((resolve) => {
            const resolver = (t) => resolve(t);
            this.completionResolvers.set(taskId, resolver);
            if (timeout > 0) {
                setTimeout(() => {
                    this.completionResolvers.delete(taskId);
                    resolve(this.tasks.get(taskId) ?? null);
                }, timeout);
            }
        });
    }
    /**
     * Cancel one or all running background tasks.
     *
     * @param taskId - Optional task ID to cancel. If omitted, cancels all pending/running tasks.
     * @returns Number of tasks cancelled
     */
    cancel(taskId) {
        if (taskId) {
            const task = this.tasks.get(taskId);
            if (task &&
                (task.status === 'pending' ||
                    task.status === 'starting' ||
                    task.status === 'running')) {
                // Clean up any waiting resolver
                this.completionResolvers.delete(taskId);
                // Check if in start queue (must check before marking cancelled)
                const inStartQueue = task.status === 'pending';
                // Mark as cancelled FIRST to prevent race with startTask
                // Use type assertion since we're deliberately changing status before completeTask
                task.status = 'cancelled';
                // Remove from start queue if pending
                if (inStartQueue) {
                    const idx = this.startQueue.findIndex((t) => t.id === taskId);
                    if (idx >= 0) {
                        this.startQueue.splice(idx, 1);
                    }
                }
                this.completeTask(task, 'cancelled', 'Cancelled by user');
                return 1;
            }
            return 0;
        }
        let count = 0;
        for (const task of this.tasks.values()) {
            if (task.status === 'pending' ||
                task.status === 'starting' ||
                task.status === 'running') {
                // Clean up any waiting resolver
                this.completionResolvers.delete(task.id);
                // Check if in start queue (must check before marking cancelled)
                const inStartQueue = task.status === 'pending';
                // Mark as cancelled FIRST to prevent race with startTask
                // Use type assertion since we're deliberately changing status before completeTask
                task.status = 'cancelled';
                // Remove from start queue if pending
                if (inStartQueue) {
                    const idx = this.startQueue.findIndex((t) => t.id === task.id);
                    if (idx >= 0) {
                        this.startQueue.splice(idx, 1);
                    }
                }
                this.completeTask(task, 'cancelled', 'Cancelled by user');
                count++;
            }
        }
        return count;
    }
    /**
     * Clean up all tasks.
     */
    cleanup() {
        this.startQueue = [];
        this.completionResolvers.clear();
        this.tasks.clear();
        this.tasksBySessionId.clear();
        this.agentBySessionId.clear();
    }
}
