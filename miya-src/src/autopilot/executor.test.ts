import { describe, expect, test } from 'bun:test';
import { runAutopilot } from './executor';

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
});
