import { describe, expect, test } from 'bun:test';
import { runUltraworkDag } from './scheduler';

interface FakeTask {
  id: string;
  agent: string;
  status: string;
}

class FakeManager {
  private seq = 0;
  private tasks = new Map<string, FakeTask>();
  constructor(
    private readonly outcomes: Record<string, Array<'completed' | 'failed'>> = {},
  ) {}

  launch(input: {
    agent: string;
    prompt: string;
    description: string;
    parentSessionId: string;
  }): FakeTask {
    this.seq += 1;
    const id = `task-${this.seq}`;
    const status = 'running';
    const task: FakeTask = { id, agent: input.agent, status };
    this.tasks.set(id, task);
    return task;
  }

  async waitForCompletion(taskID: string): Promise<FakeTask | null> {
    const task = this.tasks.get(taskID);
    if (!task) return null;
    const plan = this.outcomes[task.agent] ?? ['completed'];
    const next = plan.shift() ?? 'completed';
    task.status = next;
    this.outcomes[task.agent] = plan;
    return task;
  }

  getResult(taskID: string): FakeTask | null {
    return this.tasks.get(taskID) ?? null;
  }

  cancel(): number {
    return 0;
  }
}

describe('ultrawork dag scheduler', () => {
  test('executes dependency graph and blocks dependents on failure', async () => {
    const manager = new FakeManager({
      '5-code-fixer': ['failed'],
    });
    const result = await runUltraworkDag({
      manager,
      parentSessionID: 'main',
      tasks: [
        { id: 'A', agent: '2-code-search', prompt: 'scan', description: 'scan' },
        { id: 'B', agent: '5-code-fixer', prompt: 'fix', description: 'fix', dependsOn: ['A'] },
        { id: 'C', agent: '3-docs-helper', prompt: 'docs', description: 'docs', dependsOn: ['B'] },
      ],
    });
    expect(result.total).toBe(3);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.nodes.find((n) => n.nodeID === 'C')?.status).toBe('blocked_dependency');
  });

  test('retries failed node within retry budget', async () => {
    const manager = new FakeManager({
      '5-code-fixer': ['failed', 'completed'],
    });
    const result = await runUltraworkDag({
      manager,
      parentSessionID: 'main',
      tasks: [
        {
          id: 'fix',
          agent: '5-code-fixer',
          prompt: 'fix',
          description: 'fix',
          maxRetries: 1,
        },
      ],
    });
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.nodes[0]?.retries).toBe(1);
  });
});
