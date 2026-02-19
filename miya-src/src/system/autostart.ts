import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';

const TEST_MODE_ENV = 'MIYA_AUTOSTART_TEST_MODE';
const TEST_TASKS_ENV = 'MIYA_AUTOSTART_TEST_TASKS_JSON';
const DEFAULT_TASK_NAME = 'MiyaOpenCodeGatewayAutostart';

export type AutostartConflictKind =
  | 'legacy_miya_start_command'
  | 'duplicate_miya_gateway_task'
  | 'external_gateway_task';

export interface AutostartConflict {
  taskName: string;
  command: string;
  state?: string;
  kind: AutostartConflictKind;
}

export interface AutostartConflictResolution {
  scanned: number;
  conflictCount: number;
  conflicts: AutostartConflict[];
  disabled: string[];
  failed: Array<{ taskName: string; reason: string }>;
}

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
  conflictDetected: boolean;
  conflicts: AutostartConflict[];
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

function quotePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function isLegacyAutostartCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('miya-gateway-start')) {
    return true;
  }
  if (
    /--workspace\s+['"][^'"]*[\\/]\.opencode[\\/]miya-src['"]/i.test(command)
  ) {
    return true;
  }
  return /miya-src(?:\\\\|\\|\/)miya-src(?:\\\\|\\|\/)dist(?:\\\\|\\|\/)cli(?:\\\\|\\|\/)gateway-supervisor\.node\.js/i.test(
    command,
  );
}

function resolveAutostartCommand(projectDir: string, current?: string): string {
  const currentCommand =
    typeof current === 'string' ? current.trim() : '';
  if (!currentCommand || isLegacyAutostartCommand(currentCommand)) {
    return defaultCommand(projectDir);
  }
  return currentCommand;
}

function defaultCommand(projectDir: string): string {
  const resolvedProjectDir = path.resolve(projectDir);
  let workspaceDir = resolvedProjectDir;
  if (path.basename(resolvedProjectDir).toLowerCase() === 'miya-src') {
    const parent = path.dirname(resolvedProjectDir);
    if (path.basename(parent).toLowerCase() === '.opencode') {
      workspaceDir = parent;
    }
  }
  const escapedProjectDir = quotePowerShellLiteral(workspaceDir);
  const baseName = path.basename(workspaceDir).toLowerCase();
  const candidateSet = new Set<string>();
  candidateSet.add(
    path.join(workspaceDir, 'dist', 'cli', 'gateway-supervisor.node.js'),
  );
  if (baseName === 'miya-src') {
    candidateSet.add(
      path.join(
        path.dirname(workspaceDir),
        'miya-src',
        'dist',
        'cli',
        'gateway-supervisor.node.js',
      ),
    );
  } else {
    candidateSet.add(
      path.join(
        workspaceDir,
        'miya-src',
        'dist',
        'cli',
        'gateway-supervisor.node.js',
      ),
    );
  }
  const supervisorCandidates = [...candidateSet].map((item) =>
    quotePowerShellLiteral(item),
  );
  const scriptList = supervisorCandidates
    .map((item) => `'${item}'`)
    .join(', ');
  return `powershell -NoProfile -WindowStyle Hidden -Command "Set-Location -LiteralPath '${escapedProjectDir}'; $miyaScripts = @(${scriptList}); $miyaScript = $miyaScripts | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1; if ($miyaScript) { node $miyaScript --workspace '${escapedProjectDir}' } else { exit 1 }"`;
}

function normalizeState(
  projectDir: string,
  raw?: Record<string, unknown>,
): AutostartState {
  const enabled = raw?.enabled === true;
  const taskNameRaw =
    typeof raw?.taskName === 'string' ? raw.taskName.trim() : '';
  const commandRaw = typeof raw?.command === 'string' ? raw.command : '';
  return {
    enabled,
    taskName: taskNameRaw || DEFAULT_TASK_NAME,
    command: resolveAutostartCommand(projectDir, commandRaw),
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
  const decodeConsoleBuffer = (value: unknown): string => {
    const buffer = Buffer.isBuffer(value)
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value)
        : Buffer.from(String(value ?? ''), 'utf-8');
    if (buffer.length === 0) return '';
    const utf8 = buffer.toString('utf-8');
    const utf8Broken = (utf8.match(/\uFFFD/g) ?? []).length;
    if (utf8Broken === 0) return utf8;
    try {
      const gbk = new TextDecoder('gb18030').decode(buffer);
      const gbkBroken = (gbk.match(/\uFFFD/g) ?? []).length;
      if (gbkBroken < utf8Broken) return gbk;
    } catch {}
    return utf8;
  };

  const proc = spawnSync('schtasks', args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  return {
    ok: proc.status === 0,
    stdout: decodeConsoleBuffer(proc.stdout),
    stderr: decodeConsoleBuffer(proc.stderr),
  };
}

interface ScheduledTaskInfo {
  taskName: string;
  command: string;
  state?: string;
}

function parseTaskNames(raw: string): string[] {
  const names: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (
      !lower.startsWith('taskname:') &&
      !lower.startsWith('任务名称:') &&
      !lower.startsWith('任务名:')
    ) {
      continue;
    }
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(idx + 1).trim();
    if (!name) continue;
    names.push(name);
  }
  return names;
}

function parseScheduledTaskList(raw: string): ScheduledTaskInfo[] {
  const lines = raw.split(/\r?\n/);
  const rows: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};
  let currentKey = '';

  const flush = (): void => {
    if (Object.keys(current).length === 0) return;
    rows.push(current);
    current = {};
    currentKey = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    const sep = line.indexOf(':');
    if (sep > 0) {
      const key = line.slice(0, sep).trim().toLowerCase();
      const value = line.slice(sep + 1).trim();
      current[key] = value;
      currentKey = key;
      continue;
    }
    if (!currentKey) continue;
    const prev = current[currentKey] ?? '';
    current[currentKey] = `${prev} ${line.trim()}`.trim();
  }
  flush();

  const pick = (row: Record<string, string>, keys: string[]): string => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };

  const list: ScheduledTaskInfo[] = [];
  for (const row of rows) {
    const taskName = pick(row, ['taskname', '任务名称', '任务名']);
    const command = pick(row, ['task to run', '要运行的任务', 'actions']);
    const state = pick(row, [
      'scheduled task state',
      '计划任务状态',
      '状态',
      'status',
      '任务状态',
    ]);
    if (!taskName || !command) continue;
    list.push({ taskName, command, state });
  }
  return list;
}

function readTestModeTasks(): ScheduledTaskInfo[] {
  const raw = String(process.env[TEST_TASKS_ENV] ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const tasks: ScheduledTaskInfo[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const taskName = String(row.taskName ?? '').trim();
      const command = String(row.command ?? '').trim();
      const stateRaw = String(row.state ?? '').trim();
      if (!taskName || !command) continue;
      tasks.push({
        taskName,
        command,
        state: stateRaw || undefined,
      });
    }
    return tasks;
  } catch {
    return [];
  }
}

function listScheduledTasks(projectDir: string): ScheduledTaskInfo[] {
  if (process.platform !== 'win32') return [];
  if (isTestMode()) return readTestModeTasks();
  const state = readState(projectDir);
  const namesQuery = runSchtasks(['/Query', '/FO', 'LIST']);
  if (!namesQuery.ok || !namesQuery.stdout.trim()) return [];
  const names = parseTaskNames(namesQuery.stdout);
  const shouldInspectName = (name: string): boolean => {
    const normalized = name.toLowerCase();
    return (
      normalized.includes('miya') ||
      normalized.includes('gateway') ||
      normalized.includes('openclaw')
    );
  };
  const tasks: ScheduledTaskInfo[] = [];
  for (const taskName of names) {
    if (!shouldInspectName(taskName)) continue;
    const detail = runSchtasks(['/Query', '/TN', taskName, '/FO', 'LIST', '/V']);
    if (!detail.ok || !detail.stdout.trim()) continue;
    const parsed = parseScheduledTaskList(detail.stdout);
    if (parsed.length === 0) continue;
    const task = parsed[0];
    if (task.taskName.toLowerCase() === state.taskName.toLowerCase()) continue;
    tasks.push(task);
  }
  return tasks;
}

function isTaskDisabled(state?: string): boolean {
  const normalized = String(state ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return normalized.includes('disabled') || normalized.includes('已禁用');
}

function classifyAutostartConflict(
  task: ScheduledTaskInfo,
): AutostartConflictKind | null {
  if (isTaskDisabled(task.state)) return null;
  const name = task.taskName.toLowerCase();
  const command = task.command.toLowerCase();

  const legacyStart =
    command.includes('miya-gateway-start') ||
    (command.includes('bunx') &&
      command.includes('miya') &&
      command.includes('gateway') &&
      command.includes('start')) ||
    (command.includes('opencode') &&
      command.includes('miya') &&
      command.includes('gateway') &&
      command.includes('start'));
  if (legacyStart) return 'legacy_miya_start_command';

  const duplicateMiyaTask =
    command.includes('gateway-supervisor.node.js') &&
    (command.includes('\\miya-src\\') || command.includes('/miya-src/'));
  if (duplicateMiyaTask) return 'duplicate_miya_gateway_task';

  const externalGateway =
    name.includes('openclaw') ||
    command.includes('\\openclaw\\gateway.cmd') ||
    command.includes('/openclaw/gateway.cmd') ||
    (command.includes('openclaw') && command.includes(' gateway'));
  if (externalGateway) return 'external_gateway_task';

  return null;
}

function listAutostartConflicts(projectDir: string): AutostartConflict[] {
  const conflicts: AutostartConflict[] = [];
  for (const task of listScheduledTasks(projectDir)) {
    const kind = classifyAutostartConflict(task);
    if (!kind) continue;
    conflicts.push({
      taskName: task.taskName,
      command: task.command,
      state: task.state,
      kind,
    });
  }
  return conflicts;
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
  if (
    text.includes('cannot find') ||
    text.includes('not found') ||
    text.includes('找不到')
  ) {
    return { ok: true };
  }
  const reason =
    result.stderr.trim() ||
    result.stdout.trim() ||
    'autostart_uninstall_failed';
  return { ok: false, reason };
}

function disableTask(taskName: string): { ok: boolean; reason?: string } {
  const result = runSchtasks(['/Change', '/TN', taskName, '/DISABLE']);
  if (result.ok) return { ok: true };
  const reason =
    result.stderr.trim() || result.stdout.trim() || 'autostart_disable_failed';
  return { ok: false, reason };
}

export function reconcileAutostartConflicts(
  projectDir: string,
  input: { disableConflicts?: boolean } = {},
): AutostartConflictResolution {
  const disableConflicts = input.disableConflicts === true;
  const conflicts = listAutostartConflicts(projectDir);
  const result: AutostartConflictResolution = {
    scanned: listScheduledTasks(projectDir).length,
    conflictCount: conflicts.length,
    conflicts,
    disabled: [],
    failed: [],
  };
  if (!disableConflicts || conflicts.length === 0) return result;
  if (process.platform !== 'win32' || isTestMode()) {
    result.disabled = conflicts.map((item) => item.taskName);
    return result;
  }
  for (const conflict of conflicts) {
    const disabled = disableTask(conflict.taskName);
    if (disabled.ok) {
      result.disabled.push(conflict.taskName);
      continue;
    }
    result.failed.push({
      taskName: conflict.taskName,
      reason: disabled.reason ?? 'unknown',
    });
  }
  return result;
}

export function getAutostartStatus(projectDir: string): AutostartStatus {
  const state = readState(projectDir);
  const conflicts = listAutostartConflicts(projectDir);
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
      conflictDetected: conflicts.length > 0,
      conflicts,
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
    conflictDetected: conflicts.length > 0,
    conflicts,
    updatedAt: state.updatedAt,
  };
}

export function setAutostartEnabled(
  projectDir: string,
  input: {
    enabled: boolean;
    taskName?: string;
    command?: string;
    resolveConflicts?: boolean;
  },
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
        : resolveAutostartCommand(projectDir, current.command),
    updatedAt: nowIso(),
  };

  if (process.platform !== 'win32') {
    writeState(projectDir, next);
    return getAutostartStatus(projectDir);
  }

  if (isTestMode()) {
    if (next.enabled && input.resolveConflicts === true) {
      reconcileAutostartConflicts(projectDir, { disableConflicts: true });
    }
    writeJson(stateFile(projectDir), {
      ...next,
      installed: next.enabled,
    });
    return getAutostartStatus(projectDir);
  }

  if (next.enabled) {
    if (input.resolveConflicts === true) {
      reconcileAutostartConflicts(projectDir, { disableConflicts: true });
    }
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
