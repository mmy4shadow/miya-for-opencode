import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MiyaAutomationService } from '../../src/automation/service';
import { readHistoryRecords, writeAutomationState } from '../../src/automation/store';
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
});
