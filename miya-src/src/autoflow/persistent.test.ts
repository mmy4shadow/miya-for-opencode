import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  configureAutoflowSession,
  getAutoflowPersistentRuntimeSnapshot,
  getAutoflowSession,
  handleAutoflowPersistentEvent,
  writeAutoflowPersistentConfig,
} from './index';
import type { AutoflowManager } from './types';

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

  async waitForCompletion(taskID: string) {
    return {
      id: taskID,
      agent: '2-code-search',
      status: 'completed',
    };
  }

  getResult(taskID: string) {
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-autoflow-persistent-'));
}

describe('autoflow persistent resume', () => {
  test('auto resumes on non-user stop and reaches completed phase', async () => {
    const projectDir = tempProjectDir();
    configureAutoflowSession(projectDir, {
      sessionID: 'main',
      goal: 'ship',
      tasks: [
        {
          id: 'scan',
          agent: '2-code-search',
          prompt: 'scan',
          description: 'scan',
        },
      ],
      phase: 'planning',
    });

    const result = await handleAutoflowPersistentEvent({
      projectDir,
      manager: new FakeManager(),
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'main',
          status: {
            type: 'stopped',
            reason: 'transport_restart',
          },
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.resumed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.phase).toBe('completed');
    expect(getAutoflowSession(projectDir, 'main').phase).toBe('completed');
  });

  test('does not auto resume on user initiated stop', async () => {
    const projectDir = tempProjectDir();
    configureAutoflowSession(projectDir, {
      sessionID: 's-user',
      tasks: [
        {
          id: 'task_1',
          agent: '2-code-search',
          prompt: 'scan',
          description: 'scan',
        },
      ],
      phase: 'execution',
    });

    const result = await handleAutoflowPersistentEvent({
      projectDir,
      manager: new FakeManager(),
      event: {
        type: 'session.status',
        properties: {
          sessionID: 's-user',
          status: {
            type: 'stopped',
            reason: 'user_cancelled',
          },
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.resumed).toBe(false);
    expect(result.phase).toBe('stopped');
    expect(getAutoflowSession(projectDir, 's-user').phase).toBe('stopped');
  });

  test('respects persistent enabled switch', async () => {
    const projectDir = tempProjectDir();
    configureAutoflowSession(projectDir, {
      sessionID: 's-off',
      tasks: [
        {
          id: 'task_1',
          agent: '2-code-search',
          prompt: 'scan',
          description: 'scan',
        },
      ],
      phase: 'planning',
    });
    writeAutoflowPersistentConfig(projectDir, {
      enabled: false,
    });

    const result = await handleAutoflowPersistentEvent({
      projectDir,
      manager: new FakeManager(),
      event: {
        type: 'session.status',
        properties: {
          sessionID: 's-off',
          status: { type: 'stopped', reason: 'runtime_crash' },
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.resumed).toBe(false);
    expect(result.reason).toBe('persistent_disabled');
  });

  test('stops after repeated resume failures', async () => {
    const projectDir = tempProjectDir();
    configureAutoflowSession(projectDir, {
      sessionID: 's-fail',
      tasks: [],
      phase: 'planning',
    });
    writeAutoflowPersistentConfig(projectDir, {
      enabled: true,
      maxConsecutiveResumeFailures: 1,
      maxAutoResumes: 5,
    });

    const first = await handleAutoflowPersistentEvent({
      projectDir,
      manager: new FakeManager(),
      event: {
        type: 'session.status',
        properties: {
          sessionID: 's-fail',
          status: { type: 'stopped', reason: 'network_drop' },
        },
      },
    });
    expect(first.resumed).toBe(true);
    expect(first.success).toBe(false);

    const second = await handleAutoflowPersistentEvent({
      projectDir,
      manager: new FakeManager(),
      event: {
        type: 'session.status',
        properties: {
          sessionID: 's-fail',
          status: { type: 'stopped', reason: 'network_drop' },
        },
      },
    });
    expect(second.resumed).toBe(false);
    expect(second.reason).toBe('persistent_resume_failure_limit_reached');
    expect(getAutoflowSession(projectDir, 's-fail').phase).toBe('failed');

    const runtime = getAutoflowPersistentRuntimeSnapshot(projectDir, 20).find(
      (item) => item.sessionID === 's-fail',
    );
    expect(runtime?.resumeFailures).toBeGreaterThanOrEqual(1);
  });
});
