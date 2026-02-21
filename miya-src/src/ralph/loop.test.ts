import { describe, expect, test } from 'vitest';
import { executeRalphLoop } from './loop';
import type { RalphCommandResult } from './types';

function result(
  input: Partial<RalphCommandResult> & { command: string },
): RalphCommandResult {
  return {
    command: input.command,
    ok: input.ok ?? false,
    exitCode: input.exitCode ?? 1,
    stdout: input.stdout ?? '',
    stderr: input.stderr ?? '',
    durationMs: input.durationMs ?? 1,
  };
}

describe('ralph loop', () => {
  test('stops on repeated fingerprint cycle', () => {
    const outputs: RalphCommandResult[] = [
      result({ command: 'verify', stderr: 'TS2339 error' }),
      result({ command: 'fix', ok: true, exitCode: 0 }),
      result({ command: 'verify', stderr: 'TS2339 error' }),
    ];

    const loop = executeRalphLoop({
      taskDescription: 'cycle case',
      verificationCommand: 'verify',
      maxIterations: 5,
      timeoutMs: 1000,
      fixCommands: ['fix'],
      runCommand: () =>
        outputs.shift() ?? result({ command: 'verify', stderr: 'same' }),
      readDiff: () =>
        'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b',
    });

    expect(loop.success).toBe(false);
    expect(loop.reason).toBe('cycle_detected');
  });

  test('stops on no progress window', () => {
    const outputs: RalphCommandResult[] = [
      result({ command: 'verify', stderr: 'failing test A; case=1' }),
      result({ command: 'fix', ok: true, exitCode: 0 }),
      result({ command: 'verify', stderr: 'failing test A; case=2' }),
      result({ command: 'fix', ok: true, exitCode: 0 }),
      result({ command: 'verify', stderr: 'failing test A; case=3' }),
      result({ command: 'fix', ok: true, exitCode: 0 }),
    ];
    const loop = executeRalphLoop({
      taskDescription: 'stall case',
      verificationCommand: 'verify',
      maxIterations: 6,
      timeoutMs: 1000,
      stallWindow: 2,
      errorSimilarityThreshold: 0.8,
      fixCommands: ['fix-1', 'fix-2', 'fix-3'],
      runCommand: () =>
        outputs.shift() ?? result({ command: 'verify', stderr: 'same' }),
      readDiff: () =>
        'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b',
    });

    expect(loop.success).toBe(false);
    expect(loop.reason).toBe('no_progress');
  });

  test('stops on same line churn', () => {
    const outputs: RalphCommandResult[] = [
      result({ command: 'verify', stderr: 'assert failed 1' }),
      result({ command: 'fix', ok: true, exitCode: 0 }),
      result({ command: 'verify', stderr: 'assert failed 2' }),
      result({ command: 'fix', ok: true, exitCode: 0 }),
      result({ command: 'verify', stderr: 'assert failed 3' }),
    ];

    const loop = executeRalphLoop({
      taskDescription: 'churn case',
      verificationCommand: 'verify',
      maxIterations: 5,
      timeoutMs: 1000,
      sameLineTouchLimit: 2,
      fixCommands: ['fix', 'fix'],
      runCommand: () =>
        outputs.shift() ?? result({ command: 'verify', stderr: 'same' }),
      readDiff: () =>
        'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -20 +20 @@\n-a\n+b',
    });

    expect(loop.success).toBe(false);
    expect(loop.reason).toBe('same_line_churn');
  });

  test('renders fix command template with stderr context', () => {
    const calls: string[] = [];
    const outputs: RalphCommandResult[] = [
      result({ command: 'verify', stderr: 'TS2304: Cannot find name x' }),
      result({ command: 'fix', ok: true, exitCode: 0 }),
      result({ command: 'verify', ok: true, exitCode: 0 }),
    ];

    const loop = executeRalphLoop({
      taskDescription: 'template case',
      verificationCommand: 'verify',
      maxIterations: 3,
      timeoutMs: 1000,
      fixCommands: ['echo "{{FAILURE_SUMMARY}}|{{LAST_STDERR}}"'],
      runCommand: (command) => {
        calls.push(command);
        return outputs.shift() ?? result({ command, ok: true, exitCode: 0 });
      },
      readDiff: () => '',
    });

    expect(loop.success).toBe(true);
    expect(calls.some((item) => item.includes('TS2304'))).toBe(true);
  });
});
