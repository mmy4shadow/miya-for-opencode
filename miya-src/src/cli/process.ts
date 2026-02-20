import { spawn } from 'node:child_process';

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });

    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {}
      reject(new Error('command_timeout'));
    }, Math.max(1_000, timeoutMs));

    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}
