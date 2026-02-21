import { describe, expect, test, vi } from 'vitest';

let capturedInput: Record<string, unknown> | null = null;

vi.mock('../ralph', () => ({
  executeRalphLoop: (input: Record<string, unknown>) => {
    capturedInput = input;
    return {
      success: false,
      iterations: 2,
      reason: 'max_retries',
      summary: 'verification still failing',
      attempts: [
        {
          iteration: 1,
          type: 'verify',
          result: {
            ok: false,
            exitCode: 1,
            stdout: '',
            stderr: 'TS2339 error',
          },
          noProgress: false,
        },
      ],
    };
  },
}));

const { createRalphTools } = await import('./ralph');

describe('ralph tool wiring', () => {
  test('prefers max_retries over max_iterations and surfaces stderr summary', async () => {
    const tools = createRalphTools();
    const output = await tools.miya_ralph_loop.execute({
      task_description: 'fix compile error',
      verification_command: 'npm run test',
      max_iterations: 8,
      max_retries: 3,
      timeout_ms: 30000,
    });

    expect(capturedInput?.maxIterations).toBe(3);
    expect(String(output)).toContain('reason=max_retries');
    expect(String(output)).toContain('stderr=TS2339 error');
  });
});
