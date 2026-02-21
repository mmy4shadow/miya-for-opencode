import {
  spawn,
  spawnSync,
  type SpawnOptionsWithoutStdio,
  type SpawnSyncOptions,
} from 'node:child_process';

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeoutMs =
      typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
        ? Math.max(1, Math.floor(options.timeoutMs))
        : undefined;
    const timer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGTERM');
            } catch {}
          }, timeoutMs)
        : undefined;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export function runProcessSync(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {},
): ProcessResult {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: Boolean(result.error?.name === 'ETIMEDOUT'),
  };
}
