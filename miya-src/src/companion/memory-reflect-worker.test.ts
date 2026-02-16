import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendShortTermMemoryLog } from './memory-reflect';
import {
  enqueueReflectWorkerJob,
  listReflectWorkerJobs,
  runReflectWorkerTick,
  scheduleAutoReflectJob,
} from './memory-reflect-worker';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-reflect-worker-test-'));
}

describe('memory reflect worker queue', () => {
  test('runs queued reflect jobs with write budget', () => {
    const projectDir = tempProjectDir();
    for (let i = 0; i < 6; i += 1) {
      appendShortTermMemoryLog(projectDir, {
        sessionID: 's1',
        sender: 'user',
        text: `我喜欢测试任务 ${i}`,
      });
    }
    const job = enqueueReflectWorkerJob(projectDir, {
      reason: 'manual',
      force: true,
      minLogs: 1,
      maxLogs: 10,
      maxWrites: 2,
    });
    expect(job.status).toBe('queued');
    const tick = runReflectWorkerTick(projectDir, {
      maxJobs: 1,
      writeBudget: 2,
      mergeBudget: 5,
    });
    expect(tick.processed).toBe(1);
    expect(tick.completed).toBe(1);
    const jobs = listReflectWorkerJobs(projectDir, 5);
    expect(jobs[0]?.status).toBe('completed');
    expect((jobs[0]?.result?.generatedTriplets ?? 0) >= 1).toBe(true);
  });

  test('auto scheduler enqueues idle reflect jobs', () => {
    const projectDir = tempProjectDir();
    appendShortTermMemoryLog(projectDir, {
      sessionID: 's2',
      sender: 'user',
      text: '我喜欢自动反思',
      at: '2026-02-01T00:00:00.000Z',
    });
    const job = scheduleAutoReflectJob(projectDir, {
      idleMinutes: 10,
      minPendingLogs: 1,
      cooldownMinutes: 1,
    });
    expect(job).not.toBeNull();
    const jobs = listReflectWorkerJobs(projectDir, 5);
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.request.reason).toBe('auto_idle');
  });
});
