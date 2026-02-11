import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../utils/logger';

const startedProjects = new Set<string>();

const NON_TUI_SUBCOMMANDS = new Set([
  'run',
  'debug',
  'serve',
  'web',
  'acp',
  'mcp',
  'agent',
  'auth',
  'models',
  'stats',
  'export',
  'import',
  'github',
  'pr',
  'session',
  'upgrade',
  'uninstall',
  'attach',
  'completion',
]);

function isEnvAutostartEnabled(): boolean {
  const raw = process.env.MIYA_DOCK_AUTOSTART?.trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function isLikelyTuiStartup(argv: readonly string[]): boolean {
  const args = argv.slice(2).map((item) => item.trim().toLowerCase());
  return !args.some((item) => NON_TUI_SUBCOMMANDS.has(item));
}

export function autoStartMiyaDock(
  projectDir: string,
  options?: { enabled?: boolean },
): void {
  if (process.platform !== 'win32') return;
  if (options?.enabled === false) return;
  if (!isEnvAutostartEnabled()) return;
  if (!isLikelyTuiStartup(process.argv)) return;

  const normalizedProjectDir = path.resolve(projectDir);
  if (startedProjects.has(normalizedProjectDir)) return;
  startedProjects.add(normalizedProjectDir);

  const launcher = path.join(
    normalizedProjectDir,
    'tools',
    'miya-dock',
    'miya-launch.bat',
  );

  if (!fs.existsSync(launcher)) {
    log('[dock] auto-start skipped: launcher not found', { launcher });
    return;
  }

  try {
    const child = spawn(launcher, [], {
      cwd: path.dirname(launcher),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: true,
    });
    child.unref();
    log('[dock] auto-start trigger sent', { launcher });
  } catch (error) {
    log('[dock] auto-start failed', {
      error: error instanceof Error ? error.message : String(error),
      launcher,
    });
  }
}

export const dockAutostartInternals = {
  isLikelyTuiStartup,
  isEnvAutostartEnabled,
};
