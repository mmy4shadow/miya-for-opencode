import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runAutopilot } from './executor';
import { readAutopilotStats } from './stats';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-autopilot-test-'));
}

describe('autopilot executor', () => {
  test('runs command and verification successfully', () => {
    const result = runAutopilot({
      goal: 'basic run',
      commands: ['Write-Output "hello"'],
      verificationCommand: 'Write-Output "ok"',
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.planBundle.status).toBe('completed');
    expect(result.execution.length).toBe(1);
    expect(result.verification?.ok).toBe(true);
    expect(result.auditLedger.length).toBeGreaterThan(2);
    expect(result.retryCount).toBe(0);
  });

  test('returns failure when command fails', () => {
    const result = runAutopilot({
      goal: 'failing run',
      commands: ['exit 3'],
      timeoutMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.execution.length).toBe(1);
    expect(result.execution[0]?.exitCode).toBe(3);
    expect(result.planBundle.status).toBe('failed');
    expect(result.retryCount).toBe(0);
  });

  test('blocks run when approval is required but not granted', () => {
    const result = runAutopilot({
      goal: 'approval gated run',
      commands: ['Write-Output "hello"'],
      timeoutMs: 5000,
      approval: {
        required: true,
      },
    });
    expect(result.success).toBe(false);
    expect(result.execution.length).toBe(0);
    expect(result.planBundle.status).toBe('failed');
    expect(result.summary.includes('approval required')).toBe(true);
    expect(result.retryCount).toBe(0);
  });

  test('executes rollback command when verification fails', () => {
    const result = runAutopilot({
      goal: 'verification rollback',
      commands: ['Write-Output "hello"'],
      verificationCommand: 'exit 2',
      rollbackCommand: 'Write-Output "rollback"',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(false);
    expect(result.verification?.ok).toBe(false);
    expect(result.rollback?.ok).toBe(true);
    expect(result.planBundle.status).toBe('rolled_back');
  });

  test('retries transient command failures within retry budget', () => {
    const projectDir = tempProjectDir();
    const marker = path.join(projectDir, 'retry-marker.txt');
    const cmd =
      `if (Test-Path '${marker}') { Remove-Item '${marker}' -Force; exit 0 } ` +
      `else { New-Item -ItemType File -Path '${marker}' -Force | Out-Null; ` +
      `Write-Error 'temporary network timeout'; exit 124 }`;
    const result = runAutopilot({
      projectDir,
      goal: 'retry run',
      commands: [cmd],
      timeoutMs: 5000,
      maxRetriesPerCommand: 1,
    });
    expect(result.success).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(result.execution.length).toBe(2);

    const stats = readAutopilotStats(projectDir);
    expect(stats.totalRuns).toBe(1);
    expect(stats.totalRetries).toBe(1);
    expect(stats.successRuns).toBe(1);
  });

  test('reuses cached plan template by task signature and keeps fresh command vars', () => {
    const projectDir = tempProjectDir();
    const first = runAutopilot({
      projectDir,
      goal: 'compile target file',
      commands: ['Write-Output "compile src/a.ts"'],
      timeoutMs: 5000,
    });
    expect(first.success).toBe(true);

    const second = runAutopilot({
      projectDir,
      goal: 'compile target file',
      commands: ['Write-Output "compile src/b.ts"'],
      timeoutMs: 5000,
    });
    expect(second.success).toBe(true);
    expect(second.execution[0]?.command.includes('src/b.ts')).toBe(true);
    expect(second.auditLedger.some((row) => row.action === 'plan_template_reused')).toBe(true);
  });
});
