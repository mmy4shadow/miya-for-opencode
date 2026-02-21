import { describe, expect, test, vi } from 'vitest';
import { BackgroundTaskManager } from './background-manager';

// Mock the plugin context
function createMockContext(overrides?: {
  sessionCreateResult?: { data?: { id?: string } };
  sessionStatusResult?: { data?: Record<string, { type: string }> };
  sessionMessagesResult?: {
    data?: Array<{
      info?: { role: string };
      parts?: Array<{ type: string; text?: string }>;
    }>;
  };
  promptImpl?: (args: any) => Promise<unknown>;
}) {
  let callCount = 0;
  return {
    client: {
      session: {
        create: vi.fn(async () => {
          callCount++;
          return (
            overrides?.sessionCreateResult ?? {
              data: { id: `test-session-${callCount}` },
            }
          );
        }),
        status: vi.fn(
          async () => overrides?.sessionStatusResult ?? { data: {} },
        ),
        messages: vi.fn(
          async () => overrides?.sessionMessagesResult ?? { data: [] },
        ),
        prompt: vi.fn(async (args: any) => {
          if (overrides?.promptImpl) {
            return await overrides.promptImpl(args);
          }
          return {};
        }),
      },
    },
    directory: '/test/directory',
  } as any;
}

describe('BackgroundTaskManager', () => {
  describe('constructor', () => {
    test('creates manager with defaults', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);
      expect(manager).toBeDefined();
    });

    test('creates manager with tmux config', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx, {
        enabled: true,
        layout: 'main-vertical',
        main_pane_size: 60,
      });
      expect(manager).toBeDefined();
    });

    test('creates manager with background config', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx, undefined, {
        background: {
          maxConcurrentStarts: 5,
        },
      });
      expect(manager).toBeDefined();
    });
  });

  describe('launch (fire-and-forget)', () => {
    test('returns task immediately with pending or starting status', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'Find all test files',
        description: 'Test file search',
        parentSessionId: 'parent-123',
      });

      expect(task.id).toMatch(/^bg_/);
      // Task may be pending (in queue) or starting (already started)
      expect(['pending', 'starting']).toContain(task.status);
      expect(task.sessionId).toBeUndefined();
      expect(task.agent).toBe('2-code-search');
      expect(task.description).toBe('Test file search');
      expect(task.startedAt).toBeDefined();
    });

    test('sessionId is set asynchronously when task starts', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      // Immediately after launch, no sessionId
      expect(task.sessionId).toBeUndefined();

      // Wait for microtask queue to process
      await Promise.resolve();
      await Promise.resolve();

      // After background start, sessionId should be set
      expect(task.sessionId).toBeDefined();
      expect(task.status).toBe('running');
    });

    test('task fails when session creation fails', async () => {
      const ctx = createMockContext({ sessionCreateResult: { data: {} } });
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(task.status).toBe('failed');
      expect(task.error).toBe('Failed to create background session');
    });

    test('multiple launches return immediately', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task1 = manager.launch({
        agent: '2-code-search',
        prompt: 'test1',
        description: 'test1',
        parentSessionId: 'parent-123',
      });

      const task2 = manager.launch({
        agent: '4-architecture-advisor',
        prompt: 'test2',
        description: 'test2',
        parentSessionId: 'parent-123',
      });

      const task3 = manager.launch({
        agent: '5-code-fixer',
        prompt: 'test3',
        description: 'test3',
        parentSessionId: 'parent-123',
      });

      // All return immediately with pending or starting status
      expect(['pending', 'starting']).toContain(task1.status);
      expect(['pending', 'starting']).toContain(task2.status);
      expect(['pending', 'starting']).toContain(task3.status);
    });
  });

  describe('handleSessionStatus', () => {
    test('completes task when session becomes idle', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: 'Result text' }],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      // Wait for task to start
      await Promise.resolve();
      await Promise.resolve();

      // Simulate session.idle event
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task.sessionId,
          status: { type: 'idle' },
        },
      });

      expect(task.status).toBe('completed');
      expect(task.result).toBe('Result text');
    });

    test('ignores non-idle status', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Simulate session.busy event
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task.sessionId,
          status: { type: 'busy' },
        },
      });

      expect(task.status).toBe('running');
    });

    test('ignores non-matching session ID', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Simulate event for different session
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: 'other-session-id',
          status: { type: 'idle' },
        },
      });

      expect(task.status).toBe('running');
    });
  });

  describe('getResult', () => {
    test('returns null for unknown task', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const result = manager.getResult('unknown-task-id');
      expect(result).toBeNull();
    });

    test('returns task immediately (no blocking)', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      const result = manager.getResult(task.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(task.id);
    });
  });

  describe('waitForCompletion', () => {
    test('waits for task to complete', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: 'Done' }],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      // Wait for task to start
      await Promise.resolve();
      await Promise.resolve();

      // Trigger completion via session.status event
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task.sessionId,
          status: { type: 'idle' },
        },
      });

      // Now waitForCompletion should return immediately
      const result = await manager.waitForCompletion(task.id, 5000);
      expect(result?.status).toBe('completed');
      expect(result?.result).toBe('Done');
    });

    test('returns immediately if already completed', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: 'Done' }],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      // Wait for task to start
      await Promise.resolve();
      await Promise.resolve();

      // Trigger completion
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task.sessionId,
          status: { type: 'idle' },
        },
      });

      // Now wait should return immediately
      const result = await manager.waitForCompletion(task.id, 5000);
      expect(result?.status).toBe('completed');
    });

    test('returns null for unknown task', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const result = await manager.waitForCompletion('unknown-task-id', 5000);
      expect(result).toBeNull();
    });
  });

  describe('cancel', () => {
    test('cancels pending task before it starts', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      const count = manager.cancel(task.id);
      expect(count).toBe(1);

      const result = manager.getResult(task.id);
      expect(result?.status).toBe('cancelled');
    });

    test('cancels running task', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      // Wait for task to start
      await Promise.resolve();
      await Promise.resolve();

      const count = manager.cancel(task.id);
      expect(count).toBe(1);

      const result = manager.getResult(task.id);
      expect(result?.status).toBe('cancelled');
    });

    test('returns 0 when cancelling unknown task', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const count = manager.cancel('unknown-task-id');
      expect(count).toBe(0);
    });

    test('cancels all pending/running tasks when no ID provided', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      manager.launch({
        agent: '2-code-search',
        prompt: 'test1',
        description: 'test1',
        parentSessionId: 'parent-123',
      });

      manager.launch({
        agent: '4-architecture-advisor',
        prompt: 'test2',
        description: 'test2',
        parentSessionId: 'parent-123',
      });

      const count = manager.cancel();
      expect(count).toBe(2);
    });

    test('does not cancel already completed tasks', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: 'Done' }],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      // Wait for task to start
      await Promise.resolve();
      await Promise.resolve();

      // Trigger completion
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task.sessionId,
          status: { type: 'idle' },
        },
      });

      // Now try to cancel - should fail since already completed
      const count = manager.cancel(task.id);
      expect(count).toBe(0);
    });
  });

  describe('BackgroundTask logic', () => {
    test('falls back to next model when first model prompt fails', async () => {
      let promptCalls = 0;
      const ctx = createMockContext({
        promptImpl: async (args) => {
          const isTaskPrompt =
            typeof args.path?.id === 'string' &&
            args.path.id.startsWith('test-session-');
          const isParentNotification = !isTaskPrompt;
          if (isParentNotification) return {};

          promptCalls += 1;
          const modelRef = args.body?.model;
          if (
            modelRef?.providerID === 'openai' &&
            modelRef?.modelID === 'gpt-5.2-codex'
          ) {
            throw new Error('primary failed');
          }
          return {};
        },
      });

      const manager = new BackgroundTaskManager(ctx, undefined, {
        fallback: {
          enabled: true,
          timeoutMs: 15000,
          chains: {
            '2-code-search': ['openai/gpt-5.2-codex', 'opencode/gpt-5-nano'],
          },
        },
      });

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 10));

      expect(task.status).toBe('running');
      expect(promptCalls).toBe(2);
    });

    test('fails task when all fallback models fail', async () => {
      const ctx = createMockContext({
        promptImpl: async (args) => {
          const isTaskPrompt =
            typeof args.path?.id === 'string' &&
            args.path.id.startsWith('test-session-');
          const isParentNotification = !isTaskPrompt;
          if (isParentNotification) return {};
          throw new Error('all models failing');
        },
      });

      const manager = new BackgroundTaskManager(ctx, undefined, {
        fallback: {
          enabled: true,
          timeoutMs: 15000,
          chains: {
            '2-code-search': ['openai/gpt-5.2-codex', 'opencode/gpt-5-nano'],
          },
        },
      });

      const task = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'parent-123',
      });

      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 10));

      expect(task.status).toBe('failed');
      expect(task.error).toContain('All fallback models failed');
    });

    test('extracts content from multiple types and messages', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [
                { type: 'reasoning', text: 'I am thinking...' },
                { type: 'text', text: 'First part.' },
              ],
            },
            {
              info: { role: 'assistant' },
              parts: [
                { type: 'text', text: 'Second part.' },
                { type: 'text', text: '' }, // Should be ignored
              ],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx);

      const task = manager.launch({
        agent: 'test',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'p1',
      });

      // Wait for task to start
      await Promise.resolve();
      await Promise.resolve();

      // Trigger completion
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task.sessionId,
          status: { type: 'idle' },
        },
      });

      expect(task.status).toBe('completed');
      expect(task.result).toContain('I am thinking...');
      expect(task.result).toContain('First part.');
      expect(task.result).toContain('Second part.');
      // Check for double newline join
      expect(task.result).toBe(
        'I am thinking...\n\nFirst part.\n\nSecond part.',
      );
    });

    test('task has completedAt timestamp on completion or cancellation', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: 'done' }],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx);

      // Test completion timestamp
      const task1 = manager.launch({
        agent: 'test',
        prompt: 't1',
        description: 'd1',
        parentSessionId: 'p1',
      });

      await Promise.resolve();
      await Promise.resolve();

      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task1.sessionId,
          status: { type: 'idle' },
        },
      });

      expect(task1.completedAt).toBeInstanceOf(Date);
      expect(task1.status).toBe('completed');

      // Test cancellation timestamp
      const task2 = manager.launch({
        agent: 'test',
        prompt: 't2',
        description: 'd2',
        parentSessionId: 'p2',
      });

      manager.cancel(task2.id);
      expect(task2.completedAt).toBeInstanceOf(Date);
      expect(task2.status).toBe('cancelled');
    });

    test('always sends notification to parent session on completion', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: 'done' }],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx, undefined, {
        background: { maxConcurrentStarts: 10 },
      });

      const task = manager.launch({
        agent: 'test',
        prompt: 't',
        description: 'd',
        parentSessionId: 'parent-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: task.sessionId,
          status: { type: 'idle' },
        },
      });

      // Should have called prompt.append for notification
      expect(ctx.client.session.prompt).toHaveBeenCalled();
    });
  });

  describe('subagent delegation restrictions', () => {
    test('spawned 2-code-search gets tools disabled (leaf node)', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // First, simulate 1-task-manager starting (parent session with no parent)
      const orchestratorTask = manager.launch({
        agent: '1-task-manager',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Verify 1-task-manager's session is tracked
      const orchestratorSessionId = orchestratorTask.sessionId;
      if (!orchestratorSessionId)
        throw new Error('Expected sessionId to be defined');

      // Launch 2-code-search from 1-task-manager - 2-code-search is a leaf node so tools disabled
      manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: orchestratorSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      // Explorer cannot delegate, so delegation tools are hidden
      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      expect(lastCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });
    });

    test('spawned 5-code-fixer gets tools enabled (can delegate to 2-code-search)', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // First, launch an 2-code-search task
      const explorerTask = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Launch 5-code-fixer from 2-code-search - 5-code-fixer can delegate to 2-code-search, so tools enabled
      const explorerSessionId = explorerTask.sessionId;
      if (!explorerSessionId)
        throw new Error('Expected sessionId to be defined');

      manager.launch({
        agent: '5-code-fixer',
        prompt: 'test',
        description: 'test',
        parentSessionId: explorerSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      // Fixer can delegate (to 2-code-search), so delegation tools are enabled
      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      expect(lastCall[0].body.tools).toEqual({
        background_task: true,
        task: true,
      });
    });

    test('spawned 2-code-search from 5-code-fixer gets tools disabled (leaf node)', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Launch a 5-code-fixer task
      const fixerTask = manager.launch({
        agent: '5-code-fixer',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Launch 2-code-search from 5-code-fixer - 2-code-search is a leaf node so tools disabled
      const fixerSessionId = fixerTask.sessionId;
      if (!fixerSessionId) throw new Error('Expected sessionId to be defined');

      manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: fixerSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      expect(lastCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });
    });

    test('spawned 2-code-search from 6-ui-designer gets tools disabled (leaf node)', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Launch a 6-ui-designer task
      const designerTask = manager.launch({
        agent: '6-ui-designer',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Launch 2-code-search from 6-ui-designer - 2-code-search is a leaf node so tools disabled
      const designerSessionId = designerTask.sessionId;
      if (!designerSessionId)
        throw new Error('Expected sessionId to be defined');

      manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: designerSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      expect(lastCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });
    });

    test('3-docs-helper cannot delegate to any subagents', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Launch a 3-docs-helper task
      const librarianTask = manager.launch({
        agent: '3-docs-helper',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Launch subagent from 3-docs-helper - should have tools disabled
      const librarianSessionId = librarianTask.sessionId;
      if (!librarianSessionId)
        throw new Error('Expected sessionId to be defined');

      manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: librarianSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      expect(lastCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });
    });

    test('4-architecture-advisor cannot delegate to any subagents', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Launch an 4-architecture-advisor task
      const oracleTask = manager.launch({
        agent: '4-architecture-advisor',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      // Launch subagent from 4-architecture-advisor - should have tools disabled
      const oracleSessionId = oracleTask.sessionId;
      if (!oracleSessionId) throw new Error('Expected sessionId to be defined');

      manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: oracleSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      expect(lastCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });
    });

    test('spawned 2-code-search from unknown parent gets tools disabled (leaf node)', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Launch 2-code-search from unknown parent session (root 1-task-manager)
      manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'unknown-session-id',
      });

      await Promise.resolve();
      await Promise.resolve();

      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      // Explorer is a leaf agent — tools disabled regardless of parent
      expect(lastCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });
    });

    test('isAgentAllowed returns true for valid delegations', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const orchestratorTask = manager.launch({
        agent: '1-task-manager',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const orchestratorSessionId = orchestratorTask.sessionId;
      if (!orchestratorSessionId)
        throw new Error('Expected sessionId to be defined');

      // Orchestrator can delegate to all subagents
      expect(
        manager.isAgentAllowed(orchestratorSessionId, '2-code-search'),
      ).toBe(true);
      expect(
        manager.isAgentAllowed(orchestratorSessionId, '5-code-fixer'),
      ).toBe(true);
      expect(
        manager.isAgentAllowed(orchestratorSessionId, '6-ui-designer'),
      ).toBe(true);
      expect(
        manager.isAgentAllowed(orchestratorSessionId, '3-docs-helper'),
      ).toBe(true);
      expect(
        manager.isAgentAllowed(orchestratorSessionId, '4-architecture-advisor'),
      ).toBe(true);
    });

    test('isAgentAllowed returns false for invalid delegations', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      const fixerTask = manager.launch({
        agent: '5-code-fixer',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const fixerSessionId = fixerTask.sessionId;
      if (!fixerSessionId) throw new Error('Expected sessionId to be defined');

      // Fixer can only delegate to 2-code-search
      expect(manager.isAgentAllowed(fixerSessionId, '2-code-search')).toBe(
        true,
      );
      expect(
        manager.isAgentAllowed(fixerSessionId, '4-architecture-advisor'),
      ).toBe(false);
      expect(manager.isAgentAllowed(fixerSessionId, '6-ui-designer')).toBe(
        false,
      );
      expect(manager.isAgentAllowed(fixerSessionId, '3-docs-helper')).toBe(
        false,
      );
    });

    test('isAgentAllowed returns false for leaf agents', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Explorer is a leaf agent
      const explorerTask = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const explorerSessionId = explorerTask.sessionId;
      if (!explorerSessionId)
        throw new Error('Expected sessionId to be defined');

      expect(manager.isAgentAllowed(explorerSessionId, '5-code-fixer')).toBe(
        false,
      );

      // Librarian is also a leaf agent
      const librarianTask = manager.launch({
        agent: '3-docs-helper',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const librarianSessionId = librarianTask.sessionId;
      if (!librarianSessionId)
        throw new Error('Expected sessionId to be defined');

      expect(manager.isAgentAllowed(librarianSessionId, '2-code-search')).toBe(
        false,
      );
    });

    test('isAgentAllowed treats unknown session as root 1-task-manager', () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Unknown sessions default to 1-task-manager, which can delegate to all subagents
      expect(manager.isAgentAllowed('unknown-session', '2-code-search')).toBe(
        true,
      );
      expect(manager.isAgentAllowed('unknown-session', '5-code-fixer')).toBe(
        true,
      );
      expect(manager.isAgentAllowed('unknown-session', '6-ui-designer')).toBe(
        true,
      );
      expect(manager.isAgentAllowed('unknown-session', '3-docs-helper')).toBe(
        true,
      );
      expect(
        manager.isAgentAllowed('unknown-session', '4-architecture-advisor'),
      ).toBe(true);
    });

    test('unknown agent type defaults to 2-code-search-only delegation', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Launch a task with an agent type not in SUBAGENT_DELEGATION_RULES
      const customTask = manager.launch({
        agent: 'custom-agent',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const customSessionId = customTask.sessionId;
      if (!customSessionId) throw new Error('Expected sessionId to be defined');

      // Unknown agent types should default to 2-code-search-only
      expect(manager.getAllowedSubagents(customSessionId)).toEqual([
        '2-code-search',
      ]);
      expect(manager.isAgentAllowed(customSessionId, '2-code-search')).toBe(
        true,
      );
      expect(manager.isAgentAllowed(customSessionId, '5-code-fixer')).toBe(
        false,
      );
      expect(
        manager.isAgentAllowed(customSessionId, '4-architecture-advisor'),
      ).toBe(false);
    });

    test('spawned 2-code-search from custom agent gets tools disabled (leaf node)', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Launch a custom agent first to get a tracked session
      const parentTask = manager.launch({
        agent: 'custom-agent',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const parentSessionId = parentTask.sessionId;
      if (!parentSessionId) throw new Error('Expected sessionId to be defined');

      // Launch 2-code-search from custom agent - 2-code-search is leaf, tools disabled
      manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: parentSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      // Explorer is a leaf agent — tools disabled regardless of parent
      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const lastCall = promptCalls[promptCalls.length - 1];
      expect(lastCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });
    });

    test('full chain: 1-task-manager → 5-code-fixer → 2-code-search', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Level 1: Launch 1-task-manager from root
      const orchestratorTask = manager.launch({
        agent: '1-task-manager',
        prompt: 'coordinate work',
        description: '1-task-manager',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const orchestratorSessionId = orchestratorTask.sessionId;
      if (!orchestratorSessionId)
        throw new Error('Expected sessionId to be defined');

      // Orchestrator can delegate to 5-code-fixer
      expect(
        manager.isAgentAllowed(orchestratorSessionId, '5-code-fixer'),
      ).toBe(true);

      // Level 2: Launch 5-code-fixer from 1-task-manager
      const fixerTask = manager.launch({
        agent: '5-code-fixer',
        prompt: 'implement changes',
        description: '5-code-fixer',
        parentSessionId: orchestratorSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const fixerSessionId = fixerTask.sessionId;
      if (!fixerSessionId) throw new Error('Expected sessionId to be defined');

      // Fixer gets tools ENABLED (can delegate to 2-code-search)
      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const fixerPromptCall = promptCalls[1]; // Second prompt call is 5-code-fixer
      expect(fixerPromptCall[0].body.tools).toEqual({
        background_task: true,
        task: true,
      });

      // Fixer can delegate to 2-code-search but NOT 4-architecture-advisor
      expect(manager.isAgentAllowed(fixerSessionId, '2-code-search')).toBe(
        true,
      );
      expect(
        manager.isAgentAllowed(fixerSessionId, '4-architecture-advisor'),
      ).toBe(false);

      // Level 3: Launch 2-code-search from 5-code-fixer
      const explorerTask = manager.launch({
        agent: '2-code-search',
        prompt: 'search codebase',
        description: '2-code-search',
        parentSessionId: fixerSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const explorerSessionId = explorerTask.sessionId;
      if (!explorerSessionId)
        throw new Error('Expected sessionId to be defined');

      // Explorer gets tools DISABLED (leaf node)
      const explorerPromptCall = promptCalls[2]; // Third prompt call is 2-code-search
      expect(explorerPromptCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });

      // Explorer cannot delegate to anything
      expect(manager.isAgentAllowed(explorerSessionId, '2-code-search')).toBe(
        false,
      );
      expect(manager.isAgentAllowed(explorerSessionId, '5-code-fixer')).toBe(
        false,
      );
      expect(
        manager.isAgentAllowed(explorerSessionId, '4-architecture-advisor'),
      ).toBe(false);
      expect(manager.getAllowedSubagents(explorerSessionId)).toEqual([]);
    });

    test('full chain: 1-task-manager → 6-ui-designer → 2-code-search', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Level 1: Launch 1-task-manager
      const orchestratorTask = manager.launch({
        agent: '1-task-manager',
        prompt: 'coordinate work',
        description: '1-task-manager',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const orchestratorSessionId = orchestratorTask.sessionId;
      if (!orchestratorSessionId)
        throw new Error('Expected sessionId to be defined');

      // Level 2: Launch 6-ui-designer from 1-task-manager
      const designerTask = manager.launch({
        agent: '6-ui-designer',
        prompt: 'design UI',
        description: '6-ui-designer',
        parentSessionId: orchestratorSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const designerSessionId = designerTask.sessionId;
      if (!designerSessionId)
        throw new Error('Expected sessionId to be defined');

      // Designer gets tools ENABLED (can delegate to 2-code-search)
      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const designerPromptCall = promptCalls[1];
      expect(designerPromptCall[0].body.tools).toEqual({
        background_task: true,
        task: true,
      });

      // Designer can only spawn 2-code-search
      expect(manager.isAgentAllowed(designerSessionId, '2-code-search')).toBe(
        true,
      );
      expect(manager.isAgentAllowed(designerSessionId, '5-code-fixer')).toBe(
        false,
      );
      expect(
        manager.isAgentAllowed(designerSessionId, '4-architecture-advisor'),
      ).toBe(false);

      // Level 3: Launch 2-code-search from 6-ui-designer
      const explorerTask = manager.launch({
        agent: '2-code-search',
        prompt: 'find patterns',
        description: '2-code-search',
        parentSessionId: designerSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const explorerSessionId = explorerTask.sessionId;
      if (!explorerSessionId)
        throw new Error('Expected sessionId to be defined');

      // Explorer gets tools DISABLED
      const explorerPromptCall = promptCalls[2];
      expect(explorerPromptCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });

      // Explorer is a dead end
      expect(manager.getAllowedSubagents(explorerSessionId)).toEqual([]);
    });

    test('chain enforcement: 5-code-fixer cannot spawn unauthorized agents mid-chain', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Orchestrator spawns 5-code-fixer
      const orchestratorTask = manager.launch({
        agent: '1-task-manager',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const orchestratorSessionId = orchestratorTask.sessionId;
      if (!orchestratorSessionId)
        throw new Error('Expected sessionId to be defined');

      const fixerTask = manager.launch({
        agent: '5-code-fixer',
        prompt: 'test',
        description: 'test',
        parentSessionId: orchestratorSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const fixerSessionId = fixerTask.sessionId;
      if (!fixerSessionId) throw new Error('Expected sessionId to be defined');

      // Fixer should be blocked from spawning these agents
      expect(
        manager.isAgentAllowed(fixerSessionId, '4-architecture-advisor'),
      ).toBe(false);
      expect(manager.isAgentAllowed(fixerSessionId, '6-ui-designer')).toBe(
        false,
      );
      expect(manager.isAgentAllowed(fixerSessionId, '3-docs-helper')).toBe(
        false,
      );
      expect(manager.isAgentAllowed(fixerSessionId, '5-code-fixer')).toBe(
        false,
      );

      // Only 2-code-search is allowed
      expect(manager.isAgentAllowed(fixerSessionId, '2-code-search')).toBe(
        true,
      );
      expect(manager.getAllowedSubagents(fixerSessionId)).toEqual([
        '2-code-search',
      ]);
    });

    test('chain: completed parent does not affect child permissions', async () => {
      const ctx = createMockContext({
        sessionMessagesResult: {
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: 'done' }],
            },
          ],
        },
      });
      const manager = new BackgroundTaskManager(ctx);

      // Launch 5-code-fixer
      const fixerTask = manager.launch({
        agent: '5-code-fixer',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const fixerSessionId = fixerTask.sessionId;
      if (!fixerSessionId) throw new Error('Expected sessionId to be defined');

      // Launch 2-code-search from 5-code-fixer BEFORE 5-code-fixer completes
      const explorerTask = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: fixerSessionId,
      });

      await Promise.resolve();
      await Promise.resolve();

      const explorerSessionId = explorerTask.sessionId;
      if (!explorerSessionId)
        throw new Error('Expected sessionId to be defined');

      // Explorer has its own tracking — tools disabled
      const promptCalls = ctx.client.session.prompt.mock.calls as Array<
        [{ body: { tools?: Record<string, boolean> } }]
      >;
      const explorerPromptCall = promptCalls[1];
      expect(explorerPromptCall[0].body.tools).toEqual({
        background_task: false,
        task: false,
      });

      // Now complete the 5-code-fixer (cleans up 5-code-fixer's agentBySessionId entry)
      await manager.handleSessionStatus({
        type: 'session.status',
        properties: {
          sessionID: fixerSessionId,
          status: { type: 'idle' },
        },
      });

      expect(fixerTask.status).toBe('completed');

      // Explorer's own session tracking is independent — still works
      expect(manager.isAgentAllowed(explorerSessionId, '5-code-fixer')).toBe(
        false,
      );
      expect(manager.getAllowedSubagents(explorerSessionId)).toEqual([]);
    });

    test('getAllowedSubagents returns correct lists', async () => {
      const ctx = createMockContext();
      const manager = new BackgroundTaskManager(ctx);

      // Orchestrator -> all 5 subagent names
      const orchestratorTask = manager.launch({
        agent: '1-task-manager',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const orchestratorSessionId = orchestratorTask.sessionId;
      if (!orchestratorSessionId)
        throw new Error('Expected sessionId to be defined');

      expect(manager.getAllowedSubagents(orchestratorSessionId)).toEqual([
        '2-code-search',
        '3-docs-helper',
        '4-architecture-advisor',
        '5-code-fixer',
        '6-ui-designer',
      ]);

      // Fixer -> only 2-code-search
      const fixerTask = manager.launch({
        agent: '5-code-fixer',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const fixerSessionId = fixerTask.sessionId;
      if (!fixerSessionId) throw new Error('Expected sessionId to be defined');

      expect(manager.getAllowedSubagents(fixerSessionId)).toEqual([
        '2-code-search',
      ]);

      // Designer -> only 2-code-search
      const designerTask = manager.launch({
        agent: '6-ui-designer',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const designerSessionId = designerTask.sessionId;
      if (!designerSessionId)
        throw new Error('Expected sessionId to be defined');

      expect(manager.getAllowedSubagents(designerSessionId)).toEqual([
        '2-code-search',
      ]);

      // Explorer -> empty (leaf)
      const explorerTask = manager.launch({
        agent: '2-code-search',
        prompt: 'test',
        description: 'test',
        parentSessionId: 'root-session',
      });

      await Promise.resolve();
      await Promise.resolve();

      const explorerSessionId = explorerTask.sessionId;
      if (!explorerSessionId)
        throw new Error('Expected sessionId to be defined');

      expect(manager.getAllowedSubagents(explorerSessionId)).toEqual([]);

      // Unknown session -> 1-task-manager (all subagents)
      expect(manager.getAllowedSubagents('unknown-session')).toEqual([
        '2-code-search',
        '3-docs-helper',
        '4-architecture-advisor',
        '5-code-fixer',
        '6-ui-designer',
      ]);
    });
  });
});
