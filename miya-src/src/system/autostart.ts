import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

const TEST_MODE_ENV = 'MIYA_AUTOSTART_TEST_MODE';
const DEFAULT_TASK_NAME = 'MiyaOpenCodeGatewayAutostart';

export interface AutostartState {
  enabled: boolean;
  taskName: string;
  command: string;
  updatedAt: string;
}

export interface AutostartStatus {
  platform: NodeJS.Platform;
  supported: boolean;
  enabled: boolean;
  installed: boolean;
  taskName: string;
  command: string;
  updatedAt?: string;
  reason?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stateFile(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'autostart.json');
}

function isTestMode(): boolean {
  const raw = String(process.env[TEST_MODE_ENV] ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function readJson(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function defaultCommand(projectDir: string): string {
  const escaped = path.resolve(projectDir).replace(/'/g, "''");
  return `powershell -NoProfile -WindowStyle Hidden -Command "Set-Location -LiteralPath '${escaped}'; opencode"`;
}

function normalizeState(
  projectDir: string,
  raw?: Record<string, unknown>,
): AutostartState {
  const enabled = raw?.enabled === true;
  const taskNameRaw =
    typeof raw?.taskName === 'string' ? raw.taskName.trim() : '';
  const commandRaw = typeof raw?.command === 'string' ? raw.command.trim() : '';
  return {
    enabled,
    taskName: taskNameRaw || DEFAULT_TASK_NAME,
    command: commandRaw || defaultCommand(projectDir),
    updatedAt:
      typeof raw?.updatedAt === 'string' && raw.updatedAt.trim()
        ? raw.updatedAt
        : nowIso(),
  };
}

function readState(projectDir: string): AutostartState {
  return normalizeState(projectDir, readJson(stateFile(projectDir)));
}

function writeState(projectDir: string, state: AutostartState): void {
  writeJson(stateFile(projectDir), state);
}

function runSchtasks(args: string[]): {
  ok: boolean;
  stdout: string;
  stderr: string;
} {
  const proc = spawnSync('schtasks', args, {
    windowsHide: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  return {
    ok: proc.status === 0,
    stdout: String(proc.stdout ?? ''),
    stderr: String(proc.stderr ?? ''),
  };
}

function queryInstalled(taskName: string): boolean {
  const query = runSchtasks(['/Query', '/TN', taskName]);
  return query.ok;
}

function installTask(
  taskName: string,
  command: string,
): { ok: boolean; reason?: string } {
  const result = runSchtasks([
    '/Create',
    '/F',
    '/SC',
    'ONLOGON',
    '/RL',
    'HIGHEST',
    '/TN',
    taskName,
    '/TR',
    command,
  ]);
  if (result.ok) return { ok: true };
  const reason =
    result.stderr.trim() || result.stdout.trim() || 'autostart_install_failed';
  return { ok: false, reason };
}

function uninstallTask(taskName: string): { ok: boolean; reason?: string } {
  const result = runSchtasks(['/Delete', '/F', '/TN', taskName]);
  if (result.ok) return { ok: true };
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (text.includes('cannot find') || text.includes('not found')) {
    return { ok: true };
  }
  const reason =
    result.stderr.trim() ||
    result.stdout.trim() ||
    'autostart_uninstall_failed';
  return { ok: false, reason };
}

export function getAutostartStatus(projectDir: string): AutostartStatus {
  const state = readState(projectDir);
  const supported = process.platform === 'win32';
  if (!supported || isTestMode()) {
    const raw = readJson(stateFile(projectDir));
    const installed = raw.installed === true;
    return {
      platform: process.platform,
      supported,
      enabled: state.enabled,
      installed: supported ? installed : false,
      taskName: state.taskName,
      command: state.command,
      updatedAt: state.updatedAt,
      reason: supported ? undefined : 'platform_not_supported',
    };
  }
  return {
    platform: process.platform,
    supported,
    enabled: state.enabled,
    installed: queryInstalled(state.taskName),
    taskName: state.taskName,
    command: state.command,
    updatedAt: state.updatedAt,
  };
}

export function setAutostartEnabled(
  projectDir: string,
  input: { enabled: boolean; taskName?: string; command?: string },
): AutostartStatus {
  const current = readState(projectDir);
  const next: AutostartState = {
    enabled: input.enabled,
    taskName:
      typeof input.taskName === 'string' && input.taskName.trim()
        ? input.taskName.trim()
        : current.taskName || DEFAULT_TASK_NAME,
    command:
      typeof input.command === 'string' && input.command.trim()
        ? input.command.trim()
        : current.command || defaultCommand(projectDir),
    updatedAt: nowIso(),
  };

  if (process.platform !== 'win32') {
    writeState(projectDir, next);
    return {
      platform: process.platform,
      supported: false,
      enabled: next.enabled,
      installed: false,
      taskName: next.taskName,
      command: next.command,
      updatedAt: next.updatedAt,
      reason: 'platform_not_supported',
    };
  }

  if (isTestMode()) {
    writeJson(stateFile(projectDir), {
      ...next,
      installed: next.enabled,
    });
    return {
      platform: process.platform,
      supported: true,
      enabled: next.enabled,
      installed: next.enabled,
      taskName: next.taskName,
      command: next.command,
      updatedAt: next.updatedAt,
    };
  }

  if (next.enabled) {
    const installed = installTask(next.taskName, next.command);
    if (!installed.ok) {
      throw new Error(
        `autostart_enable_failed:${installed.reason ?? 'unknown'}`,
      );
    }
  } else {
    const removed = uninstallTask(next.taskName);
    if (!removed.ok) {
      throw new Error(
        `autostart_disable_failed:${removed.reason ?? 'unknown'}`,
      );
    }
  }
  writeState(projectDir, next);
  return getAutostartStatus(projectDir);
}
