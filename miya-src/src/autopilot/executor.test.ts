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
    expect(result.execution.length).toBe(1);
    expect(result.verification?.ok).toBe(true);
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
  });
});

