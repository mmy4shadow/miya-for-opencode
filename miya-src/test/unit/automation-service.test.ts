import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MiyaAutomationService } from '../../src/automation/service';
import {
  readAutomationState,
  readHistoryRecords,
  writeAutomationState,
} from '../../src/automation/store';
import type { MiyaAutomationState } from '../../src/automation/types';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-automation-service-test-'));
}

describe('MiyaAutomationService security and resilience', () => {
  test('rejects schedule when cwd escapes project directory', () => {
    const projectDir = tempProjectDir();
    const service = new MiyaAutomationService(projectDir);

    expect(() =>
      service.scheduleDailyCommand({
        name: 'unsafe',
        time: '09:30',
        command: 'node --version',
        cwd: '../outside',
      }),
    ).toThrow('must stay within project directory');
  });

  test('normalizes relative cwd and timeout while preserving execution', async () => {
    const projectDir = tempProjectDir();
    const nested = path.join(projectDir, 'jobs', 'daily');
    fs.mkdirSync(nested, { recursive: true });
    const service = new MiyaAutomationService(projectDir);

    const job = service.scheduleDailyCommand({
      name: 'normalize-job',
      time: '08:10',
      command:
        "node -e \"const fs=require('fs');fs.writeFileSync('probe.txt', process.cwd());\"",
      cwd: 'jobs/daily',
      timeoutMs: 10,
    });

    expect(job.action.cwd).toBe(path.join(projectDir, 'jobs', 'daily'));
    expect(job.action.timeoutMs).toBe(1000);

    const result = await service.runJobNow(job.id);
    expect(result?.status).toBe('success');
    expect(fs.existsSync(path.join(nested, 'probe.txt'))).toBe(true);
  });

  test('sanitizes legacy unsafe cwd at runtime instead of executing out of scope', async () => {
    const projectDir = tempProjectDir();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-outside-'));
    const state: MiyaAutomationState = {
      jobs: [
        {
          id: 'job-legacy',
          name: 'legacy-unsafe-cwd',
          enabled: true,
          requireApproval: false,
          schedule: { type: 'daily', time: '10:00' },
          action: {
            type: 'command',
            command:
              "node -e \"const fs=require('fs');fs.writeFileSync('legacy-probe.txt', process.cwd());\"",
            cwd: outside,
            timeoutMs: 5000,
          },
          nextRunAt: new Date(Date.now() - 5_000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      approvals: [],
    };
    writeAutomationState(projectDir, state);
    const service = new MiyaAutomationService(projectDir);

    const result = await service.runJobNow('job-legacy');
    expect(result).not.toBeNull();
    expect(result?.stderr).toContain('Unsafe cwd detected');
    expect(fs.existsSync(path.join(projectDir, 'legacy-probe.txt'))).toBe(true);
    expect(fs.existsSync(path.join(outside, 'legacy-probe.txt'))).toBe(false);

    const history = readHistoryRecords(projectDir, 1);
    expect(history[0]?.stderr).toContain('Unsafe cwd detected');
  });

  test('rejects empty command at schedule stage', () => {
    const projectDir = tempProjectDir();
    const service = new MiyaAutomationService(projectDir);

    expect(() =>
      service.scheduleDailyCommand({
        name: 'empty-cmd',
        time: '12:00',
        command: '   ',
      }),
    ).toThrow('Command cannot be empty');
  });

  test('scheduler advances nextRunAt after execution to prevent repeated same-day reruns', async () => {
    const projectDir = tempProjectDir();
    const now = new Date();
    const dueAt = new Date(now.getTime() - 60_000).toISOString();
    const state: MiyaAutomationState = {
      jobs: [
        {
          id: 'job-due-once',
          name: 'due-once',
          enabled: true,
          requireApproval: false,
          schedule: { type: 'daily', time: '00:00' },
          action: {
            type: 'command',
            command: `"${process.execPath}" -e "process.stdout.write('ok')"`,
            cwd: projectDir,
            timeoutMs: 5_000,
          },
          nextRunAt: dueAt,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      approvals: [],
    };
    writeAutomationState(projectDir, state);

    const service = new MiyaAutomationService(projectDir);
    await service.tick();

    const afterFirstTick = readAutomationState(projectDir);
    const nextRunAt = Date.parse(afterFirstTick.jobs[0]?.nextRunAt ?? '');
    expect(Number.isFinite(nextRunAt)).toBe(true);
    expect(nextRunAt).toBeGreaterThan(Date.now());
    expect(readHistoryRecords(projectDir, 10).length).toBe(1);

    await service.tick();
    expect(readHistoryRecords(projectDir, 10).length).toBe(1);
  });

  test('continues scheduler tick when one due job has invalid schedule data', async () => {
    const projectDir = tempProjectDir();
    const dueAt = new Date(Date.now() - 60_000).toISOString();
    const state: MiyaAutomationState = {
      jobs: [
        {
          id: 'job-invalid-time',
          name: 'invalid-time',
          enabled: true,
          requireApproval: false,
          schedule: { type: 'daily', time: 'invalid' },
          action: {
            type: 'command',
            command: `"${process.execPath}" -e "process.stdout.write('should-not-run')"`,
            cwd: projectDir,
            timeoutMs: 5_000,
          },
          nextRunAt: dueAt,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'job-valid-time',
          name: 'valid-time',
          enabled: true,
          requireApproval: false,
          schedule: { type: 'daily', time: '00:00' },
          action: {
            type: 'command',
            command: `"${process.execPath}" -e "process.stdout.write('ok')"`,
            cwd: projectDir,
            timeoutMs: 5_000,
          },
          nextRunAt: dueAt,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      approvals: [],
    };
    writeAutomationState(projectDir, state);
    const service = new MiyaAutomationService(projectDir);

    await service.tick();

    const history = readHistoryRecords(projectDir, 10);
    const invalidEntry = history.find((item) => item.jobId === 'job-invalid-time');
    const validEntry = history.find((item) => item.jobId === 'job-valid-time');
    expect(invalidEntry?.status).toBe('failed');
    expect(invalidEntry?.stderr).toContain('invalid_schedule_time');
    expect(validEntry?.status).toBe('success');
  });

  test('blocks concurrent manual execution for the same job with actionable error', async () => {
    const projectDir = tempProjectDir();
    const service = new MiyaAutomationService(projectDir);
    const job = service.scheduleDailyCommand({
      name: 'concurrent-job',
      time: '08:00',
      command: `"${process.execPath}" -e "setTimeout(()=>process.stdout.write('done'), 200)"`,
      timeoutMs: 5_000,
    });

    const firstRun = service.runJobNow(job.id);
    const secondRun = await service.runJobNow(job.id);
    const firstResult = await firstRun;

    expect(firstResult?.status).toBe('success');
    expect(secondRun?.status).toBe('skipped');
    expect(secondRun?.stderr).toContain('job_execution_in_progress');
  });

  test('adds actionable timeout hint and releases lock for subsequent runs', async () => {
    const projectDir = tempProjectDir();
    const service = new MiyaAutomationService(projectDir);
    const job = service.scheduleDailyCommand({
      name: 'timeout-job',
      time: '07:00',
      command: `"${process.execPath}" -e "setTimeout(()=>{}, 2000)"`,
      timeoutMs: 1_000,
    });

    const timedOut = await service.runJobNow(job.id);
    expect(timedOut?.status).toBe('failed');
    expect(timedOut?.timedOut).toBe(true);
    expect(timedOut?.stderr).toContain('command_timeout');

    const rerun = await service.runJobNow(job.id);
    expect(rerun).not.toBeNull();
    expect(rerun?.stderr).not.toContain('job_execution_in_progress');
  });
});
