import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { runAutoflow } from './engine';
import type { AutoflowCommandResult, AutoflowManager } from './types';

class FakeManager implements AutoflowManager {
  launch(input: {
    agent: string;
    prompt: string;
    description: string;
    parentSessionId: string;
  }) {
    return {
      id: `task-${Math.random().toString(36).slice(2, 8)}`,
      agent: input.agent,
      status: 'running',
    };
  }

  async waitForCompletion(
    taskID: string,
  ): Promise<ReturnType<FakeManager['launch']> | null> {
    return {
      id: taskID,
      agent: '2-code-search',
      status: 'completed',
    };
  }

  getResult(taskID: string): ReturnType<FakeManager['launch']> | null {
    return {
      id: taskID,
      agent: '2-code-search',
      status: 'completed',
    };
  }

  cancel(): number {
    return 0;
  }
}

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-autoflow-'));
}

function commandResult(
  input: Partial<AutoflowCommandResult> &
    Pick<AutoflowCommandResult, 'command' | 'ok'>,
): AutoflowCommandResult {
  return {
    command: input.command,
    ok: input.ok,
    exitCode: input.exitCode ?? (input.ok ? 0 : 1),
    stdout: input.stdout ?? '',
    stderr: input.stderr ?? '',
    durationMs: input.durationMs ?? 10,
  };
}

describe('autoflow engine', () => {
  test('returns planning wait when no executable tasks exist', async () => {
    const projectDir = tempProjectDir();
    const result = await runAutoflow({
      projectDir,
      sessionID: 'main',
      manager: new FakeManager(),
      forceRestart: true,
      goal: 'ship feature',
      tasks: [],
    });

    expect(result.success).toBe(false);
    expect(result.phase).toBe('planning');
    expect(result.summary).toBe('planning_requires_tasks');
    expect(
      result.state.history.some((item) => item.event === 'planning_waiting'),
    ).toBe(true);
  });

  test('completes after successful execution and verification', async () => {
    const projectDir = tempProjectDir();
    let dagRuns = 0;
    const result = await runAutoflow({
      projectDir,
      sessionID: 'main',
      manager: new FakeManager(),
      forceRestart: true,
      tasks: [
        {
          id: 'scan',
          agent: '2-code-search',
          prompt: 'scan codebase',
          description: 'scan',
        },
      ],
      verificationCommand: 'npm run test',
      runDag: async () => {
        dagRuns += 1;
        return {
          total: 1,
          completed: 1,
          failed: 0,
          blocked: 0,
          nodes: [
            {
              nodeID: 'scan',
              agent: '2-code-search',
              status: 'completed',
              retries: 0,
            },
          ],
        };
      },
      runCommand: (command) => commandResult({ command, ok: true }),
    });

    expect(dagRuns).toBe(1);
    expect(result.success).toBe(true);
    expect(result.phase).toBe('completed');
    expect(result.summary).toBe('autoflow_completed');
    expect(result.state.lastError).toBeUndefined();
  });

  test('runs fix command after verification failure and then completes', async () => {
    const projectDir = tempProjectDir();
    let verifyCount = 0;
    const commands: string[] = [];

    const result = await runAutoflow({
      projectDir,
      sessionID: 'main',
      manager: new FakeManager(),
      forceRestart: true,
      tasks: [
        {
          id: 'fix',
          agent: '5-code-fixer',
          prompt: 'repair',
          description: 'repair',
        },
      ],
      verificationCommand: 'npm run test',
      fixCommands: ['npm run lint -- --fix'],
      runDag: async () => ({
        total: 1,
        completed: 1,
        failed: 0,
        blocked: 0,
        nodes: [
          {
            nodeID: 'fix',
            agent: '5-code-fixer',
            status: 'completed',
            retries: 0,
          },
        ],
      }),
      runCommand: (command) => {
        commands.push(command);
        if (command === 'npm run test') {
          verifyCount += 1;
          if (verifyCount === 1) {
            return commandResult({
              command,
              ok: false,
              stderr: 'tests failed',
            });
          }
          return commandResult({ command, ok: true });
        }
        return commandResult({ command, ok: true });
      },
    });

    expect(result.success).toBe(true);
    expect(result.phase).toBe('completed');
    expect(result.state.fixRound).toBe(1);
    expect(commands).toEqual([
      'npm run test',
      'npm run lint -- --fix',
      'npm run test',
    ]);
    expect(result.fixResult?.command).toBe('npm run lint -- --fix');
  });

  test('fails on repeated identical verification failures', async () => {
    const projectDir = tempProjectDir();
    let verifyCount = 0;

    const result = await runAutoflow({
      projectDir,
      sessionID: 'main',
      manager: new FakeManager(),
      forceRestart: true,
      maxFixRounds: 5,
      tasks: [
        {
          id: 'scan',
          agent: '2-code-search',
          prompt: 'scan',
          description: 'scan',
        },
      ],
      verificationCommand: 'npm run test',
      fixCommands: [
        'npm run lint -- --fix',
        'npm run lint -- --fix',
        'npm run lint -- --fix',
      ],
      runDag: async () => ({
        total: 1,
        completed: 1,
        failed: 0,
        blocked: 0,
        nodes: [
          {
            nodeID: 'scan',
            agent: '2-code-search',
            status: 'completed',
            retries: 0,
          },
        ],
      }),
      runCommand: (command) => {
        if (command === 'npm run test') {
          verifyCount += 1;
          return commandResult({
            command,
            ok: false,
            stderr: 'same-failure',
          });
        }
        return commandResult({ command, ok: true });
      },
    });

    expect(verifyCount).toBe(3);
    expect(result.success).toBe(false);
    expect(result.phase).toBe('failed');
    expect(result.summary).toContain('verification_repeated_failure');
    expect(result.state.fixRound).toBe(2);
  });
});
