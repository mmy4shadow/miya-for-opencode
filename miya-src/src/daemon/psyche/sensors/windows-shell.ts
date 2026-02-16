import { spawnSync } from 'node:child_process';

export interface WindowsShellResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

function normalizeStdout(stdout: unknown): string {
  if (typeof stdout !== 'string') return '';
  return stdout.trim();
}

export function runWindowsPowerShellJson<T>(
  script: string,
  timeoutMs: number,
): WindowsShellResult<T> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'platform_not_windows' };
  }
  const command = String(script ?? '').trim();
  if (!command) return { ok: false, error: 'empty_script' };
  try {
    const child = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ],
      {
        timeout: Math.max(300, timeoutMs),
        encoding: 'utf-8',
        windowsHide: true,
      },
    );
    if (child.error) {
      return {
        ok: false,
        error: child.error.message || 'spawn_failed',
      };
    }
    if (child.status !== 0) {
      return {
        ok: false,
        error: normalizeStdout(child.stderr) || `exit_${child.status}`,
      };
    }
    const text = normalizeStdout(child.stdout);
    if (!text) return { ok: false, error: 'empty_stdout' };
    try {
      return {
        ok: true,
        value: JSON.parse(text) as T,
      };
    } catch {
      return { ok: false, error: 'json_parse_failed' };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
