#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runNodeHost } from '../nodes/client';
import { currentPolicyHash } from '../policy';
import { log } from '../utils/logger';
import {
  installGatewayCrashGuards,
} from './gateway-crash-guard';
import { install } from './install';
import type { BooleanArg, InstallArgs } from './types';

function parseInstallArgs(args: string[]): InstallArgs {
  const result: InstallArgs = {
    tui: true,
  };

  for (const arg of args) {
    if (arg === '--no-tui') {
      result.tui = false;
    } else if (arg.startsWith('--kimi=')) {
      result.kimi = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--openai=')) {
      result.openai = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--anthropic=')) {
      result.anthropic = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--copilot=')) {
      result.copilot = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--zai-plan=')) {
      result.zaiPlan = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--antigravity=')) {
      result.antigravity = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--chutes=')) {
      result.chutes = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--tmux=')) {
      result.tmux = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--skills=')) {
      result.skills = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--opencode-free=')) {
      result.opencodeFree = arg.split('=')[1] as BooleanArg;
    } else if (arg.startsWith('--opencode-free-model=')) {
      result.opencodeFreeModel = arg.split('=')[1];
    } else if (arg.startsWith('--isolated=')) {
      result.isolated = arg.split('=')[1] as BooleanArg;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
miya cli

Usage:
  miya install [OPTIONS]
  miya gateway <start|serve|shell|status|doctor|shutdown|autostart>
  miya sessions <list|get|send|policy>
  miya channels <list|status|pairs|approve|reject|send>
  miya nodes <list|status|describe|pairs|approve|reject|invoke>
  miya skills <status|enable|disable|install|update>
  miya sync <list|pull|diff|apply|rollback>
  miya cron <list|runs|add|run|remove|approvals|approve|reject>
  miya voice <status|wake-on|wake-off|talk-start|talk-stop|ingest|history|clear>
  miya canvas <status|list|get|open|render|close>
  miya companion <status|wizard|profile|memory-add|memory-list|asset-add|asset-list|reset>

Examples:
  miya gateway status
  miya gateway shell start
  miya gateway autostart install
  miya sessions send webchat:main "hello"
  miya channels send telegram 123456 "hi"
  miya nodes invoke node-1 system.run '{"command":"pwd"}'
  miya sync list
  miya node-host --gateway http://127.0.0.1:17321
  miya install --no-tui --kimi=yes --openai=no --anthropic=no --copilot=no --zai-plan=no --antigravity=no --chutes=no --tmux=no --skills=yes --isolated=yes
`);
}

const ANSI = {
  dim: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  white: '\x1b[97m',
  reset: '\x1b[0m',
};

function supportsAnsi(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.platform !== 'win32') return true;
  return (
    process.env.FORCE_COLOR === '1' ||
    process.env.WT_SESSION !== undefined ||
    process.env.TERM_PROGRAM === 'vscode'
  );
}

function color(text: string, value: string): string {
  if (!supportsAnsi()) return text;
  return `${value}${text}${ANSI.reset}`;
}

function formatClock(ts: string): string {
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return ts;
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mm = String(parsed.getMinutes()).padStart(2, '0');
  const ss = String(parsed.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function gatewayLogFilePath(): string {
  return path.join(os.tmpdir(), 'miya.log');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseModuleAndBody(line: string): {
  moduleTag: string;
  body: string;
} {
  const trimmed = line.trim();
  const moduleParsed = /^(\[[^\]]+\])\s?(.*)$/.exec(trimmed);
  return {
    moduleTag: moduleParsed?.[1] ?? '[gateway]',
    body: moduleParsed?.[2] ?? trimmed,
  };
}

function formatGatewayConsoleLine(raw: string): string {
  const parsed = /^\[([^\]]+)\]\s(.*)$/.exec(raw);
  if (!parsed) return raw;
  const [, ts, message] = parsed;
  const parsedMessage = parseModuleAndBody(message);
  const moduleTag = parsedMessage.moduleTag;
  const body = parsedMessage.body;
  const bodyColor = terminalLevelColor(classifyGatewayLine(body));
  const clock = color(formatClock(ts), ANSI.dim);
  const moduleColored = color(moduleTag, ANSI.magenta);
  const bodyColored = color(colorizeGatewayHighlights(body), bodyColor);
  return `${clock} ${moduleColored} ${bodyColored}`;
}

function colorizeGatewayHighlights(message: string): string {
  if (!supportsAnsi()) return message;
  return message.replace(
    /(https?:\/\/\S+|(?:^|\s)(?:miya|opencode)\s+gateway\s+[a-z0-9:_-]+|v\d+\.\d+\.\d+(?:[-+._a-z0-9]+)?)/gi,
    (match) => `${ANSI.blue}${match}${ANSI.reset}`,
  );
}

function nowClock(): string {
  const now = new Date();
  return [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':');
}

type GatewayTerminalLevel = 'info' | 'warn' | 'error' | 'link';

function terminalLevelColor(level: GatewayTerminalLevel): string {
  if (level === 'error') return ANSI.red;
  if (level === 'warn') return ANSI.yellow;
  if (level === 'link') return ANSI.blue;
  return ANSI.white;
}

function classifyGatewayLine(message: string): GatewayTerminalLevel {
  const lower = message.toLowerCase();
  if (
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('exception') ||
    lower.includes('traceback') ||
    lower.includes('stack')
  ) {
    return 'error';
  }
  if (lower.includes('warn') || lower.includes('degraded')) {
    return 'warn';
  }
  if (
    /https?:\/\//i.test(message) ||
    /\b(v\d+\.\d+\.\d+)\b/i.test(message) ||
    /\b(?:miya|opencode)\s+gateway\s+[a-z0-9:_-]+\b/i.test(message)
  ) {
    return 'link';
  }
  return 'info';
}

function formatGatewayTerminalEvent(
  moduleTag: string,
  message: string,
  level?: GatewayTerminalLevel,
): string {
  const effective = level ?? classifyGatewayLine(message);
  const clock = color(nowClock(), ANSI.dim);
  const moduleColored = color(`[${moduleTag}]`, ANSI.magenta);
  const bodyColored = color(
    colorizeGatewayHighlights(message),
    terminalLevelColor(effective),
  );
  return `${clock} ${moduleColored} ${bodyColored}`;
}

function printGatewayTerminalEvent(
  moduleTag: string,
  message: string,
  level?: GatewayTerminalLevel,
): void {
  console.log(formatGatewayTerminalEvent(moduleTag, message, level));
}

interface GatewayCliRuntime {
  scriptPath: string;
  useTsxLoader: boolean;
}

function resolveGatewayCliRuntime(workspace: string): GatewayCliRuntime | null {
  const distCli = path.join(workspace, 'dist', 'cli', 'index.js');
  if (fs.existsSync(distCli)) {
    return { scriptPath: distCli, useTsxLoader: false };
  }
  const selfCli = resolveCliScriptPath();
  if (selfCli.endsWith('.js')) {
    return { scriptPath: selfCli, useTsxLoader: false };
  }
  if (selfCli.endsWith('.ts')) {
    return { scriptPath: selfCli, useTsxLoader: true };
  }
  const workspaceSrcCli = path.join(workspace, 'src', 'cli', 'index.ts');
  if (fs.existsSync(workspaceSrcCli)) {
    return { scriptPath: workspaceSrcCli, useTsxLoader: true };
  }
  return null;
}

function readAllLogLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  try {
    return fs
      .readFileSync(file, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function startGatewayLogTail(
  file: string,
  onLine: (line: string) => void,
  options?: { startAt?: 'start' | 'end' },
): () => void {
  let cursor = 0;
  let partial = '';
  let timer: NodeJS.Timeout | undefined;
  const maxChunkBytes = 256 * 1024;
  const startAt = options?.startAt ?? 'end';

  const consume = (chunk: string): void => {
    partial += chunk;
    const lines = partial.split(/\r?\n/);
    partial = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length > 0) onLine(line);
    }
  };

  const poll = (): void => {
    if (!fs.existsSync(file)) return;
    const stat = fs.statSync(file);
    if (stat.size < cursor) {
      cursor = 0;
      partial = '';
    }
    if (stat.size === cursor) return;
    let remaining = stat.size - cursor;
    if (remaining <= 0) return;

    const fd = fs.openSync(file, 'r');
    try {
      while (remaining > 0) {
        const chunkSize = Math.min(remaining, maxChunkBytes);
        const chunk = Buffer.alloc(chunkSize);
        const bytesRead = fs.readSync(fd, chunk, 0, chunkSize, cursor);
        if (bytesRead <= 0) break;
        cursor += bytesRead;
        remaining -= bytesRead;
        consume(chunk.subarray(0, bytesRead).toString('utf-8'));
      }
    } finally {
      fs.closeSync(fd);
    }
  };

  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    cursor = startAt === 'start' ? 0 : stat.size;
    if (startAt === 'start') {
      poll();
    }
  }

  timer = setInterval(() => {
    try {
      poll();
    } catch {}
  }, 350);

  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}

function windowsStartupDir(): string | null {
  if (process.platform !== 'win32') return null;
  const appData = process.env.APPDATA?.trim();
  if (!appData) return null;
  return path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
  );
}

function gatewayAutostartScriptPath(): string {
  const startup = windowsStartupDir();
  if (!startup) return '';
  return path.join(startup, 'miya-gateway-terminal.cmd');
}

function gatewayAutostartVbsPath(): string {
  const startup = windowsStartupDir();
  if (!startup) return '';
  return path.join(startup, 'miya-gateway-autostart.vbs');
}

function gatewayAutostartLauncherPath(workspace: string): string {
  return path.join(
    workspace,
    '.opencode',
    'miya',
    'autostart',
    'miya-gateway-autostart.cmd',
  );
}

function gatewayAutostartMetaFile(workspace: string): string {
  return path.join(
    workspace,
    '.opencode',
    'miya',
    'autostart',
    'gateway-autostart.json',
  );
}

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function renderGatewayAutostartScript(input: {
  workspace: string;
  nodeBinary: string;
  cliRuntime: GatewayCliRuntime;
  mode: 'serve' | 'service_shell';
}): string {
  const commandPrefix = [
    quoteForCmd(input.nodeBinary),
    ...(input.cliRuntime.useTsxLoader ? ['--import tsx'] : []),
    quoteForCmd(input.cliRuntime.scriptPath),
  ].join(' ');
  const commandArgs =
    input.mode === 'service_shell'
      ? [
          'gateway start',
          '--force',
          `--workspace ${quoteForCmd(input.workspace)}`,
        ]
          .filter(Boolean)
          .join(' ')
      : [
          `gateway ${input.mode}`,
          `--workspace ${quoteForCmd(input.workspace)}`,
        ]
          .filter(Boolean)
          .join(' ');
  return [
    '@echo off',
    'setlocal',
    `cd /d ${quoteForCmd(input.workspace)}`,
    'set "MIYA_AUTO_UI_OPEN=0"',
    'set "MIYA_DOCK_AUTO_LAUNCH=0"',
    'set "MIYA_GATEWAY_CLI_START_ENABLE=1"',
    `${commandPrefix} ${commandArgs}`,
    'endlocal',
    '',
  ].join('\r\n');
}

function renderGatewayAutostartVbs(launcherPath: string): string {
  const escaped = launcherPath.replace(/"/g, '""');
  return [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run Chr(34) & "${escaped}" & Chr(34), 0, False`,
    'Set shell = Nothing',
    '',
  ].join('\r\n');
}

function readAutostartMode(
  workspace: string,
): 'serve' | 'service_shell' | 'unknown' {
  const file = gatewayAutostartMetaFile(workspace);
  if (!fs.existsSync(file)) return 'unknown';
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      mode?: unknown;
    };
    if (
      parsed.mode === 'serve' ||
      parsed.mode === 'service_shell'
    )
      return parsed.mode;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function terminalLockFilePath(workspace: string): string {
  return path.join(
    workspace,
    '.opencode',
    'miya',
    'gateway-terminal.lock.json',
  );
}

function acquireTerminalLock(workspace: string): {
  ok: boolean;
  ownerPid?: number;
} {
  const lockFile = terminalLockFilePath(workspace);
  if (fs.existsSync(lockFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as {
        pid?: unknown;
      };
      const pid = Number(parsed.pid);
      if (Number.isFinite(pid) && pid > 0 && isPidAlive(pid)) {
        return { ok: false, ownerPid: pid };
      }
    } catch {}
  }
  if (!fs.existsSync(path.dirname(lockFile))) {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  }
  fs.writeFileSync(
    lockFile,
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf-8',
  );
  return { ok: true };
}

function releaseTerminalLock(workspace: string): void {
  const lockFile = terminalLockFilePath(workspace);
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as {
      pid?: unknown;
    };
    if (Number(parsed.pid) !== process.pid) return;
  } catch {}
  try {
    fs.unlinkSync(lockFile);
  } catch {}
}

function gatewayShellStateFile(workspace: string): string {
  return path.join(workspace, '.opencode', 'miya', 'gateway-shell.json');
}

interface GatewayShellState {
  pid: number;
  workspace: string;
  startedAt: string;
  visible: boolean;
}

function readGatewayShellState(workspace: string): GatewayShellState | null {
  const file = gatewayShellStateFile(workspace);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      pid?: unknown;
      workspace?: unknown;
      startedAt?: unknown;
      visible?: unknown;
    };
    const pid = Number(parsed.pid);
    const stateWorkspace = String(parsed.workspace ?? workspace);
    const startedAt = String(parsed.startedAt ?? '');
    const visible =
      parsed.visible === undefined ? true : Boolean(parsed.visible);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return null;
    return { pid, workspace: stateWorkspace, startedAt, visible };
  } catch {
    return null;
  }
}

function writeGatewayShellState(
  workspace: string,
  state: GatewayShellState,
): void {
  const file = gatewayShellStateFile(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function clearGatewayShellState(workspace: string): void {
  try {
    fs.unlinkSync(gatewayShellStateFile(workspace));
  } catch {}
}

function gatewayShellLaunchGuardFile(workspace: string): string {
  return path.join(
    workspace,
    '.opencode',
    'miya',
    'gateway-shell-launch.guard.json',
  );
}

function readGatewayShellLaunchGuardAgeMs(workspace: string): number | null {
  const file = gatewayShellLaunchGuardFile(workspace);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      updatedAt?: unknown;
      pid?: unknown;
    };
    const updatedAt = String(parsed.updatedAt ?? '').trim();
    if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return null;
    const ownerPid = Number(parsed.pid);
    if (Number.isFinite(ownerPid) && ownerPid > 0 && !isPidAlive(ownerPid)) {
      return null;
    }
    return Date.now() - Date.parse(updatedAt);
  } catch {
    return null;
  }
}

function writeGatewayShellLaunchGuard(workspace: string): void {
  const file = gatewayShellLaunchGuardFile(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      { pid: process.pid, updatedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
    'utf-8',
  );
}

function clearGatewayShellLaunchGuard(workspace: string): void {
  const file = gatewayShellLaunchGuardFile(workspace);
  if (!fs.existsSync(file)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      pid?: unknown;
    };
    const ownerPid = Number(parsed.pid);
    if (Number.isFinite(ownerPid) && ownerPid > 0 && ownerPid !== process.pid) {
      return;
    }
  } catch {}
  try {
    fs.unlinkSync(file);
  } catch {}
}

function setWindowVisibleByPid(pid: number, visible: boolean): boolean {
  if (process.platform !== 'win32') return false;
  const showCode = visible ? 5 : 0;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MiyaShellWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if (-not $p) { exit 2 }
$target = [uint32]${pid}
$matches = New-Object System.Collections.Generic.List[IntPtr]
$enum = [MiyaShellWin32+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $owner = [uint32]0
  [MiyaShellWin32]::GetWindowThreadProcessId($hWnd, [ref]$owner) | Out-Null
  if ($owner -eq $target) {
    $matches.Add($hWnd) | Out-Null
  }
  return $true
}
[MiyaShellWin32]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($matches.Count -eq 0) { exit 3 }
foreach ($h in $matches) {
  [MiyaShellWin32]::ShowWindowAsync([IntPtr]$h, ${showCode}) | Out-Null
}
exit 0
`.trim();
  try {
    const result = spawnSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        stdio: 'ignore',
        timeout: 4_000,
        windowsHide: true,
      },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

function findGatewayShellPidByTitle(title: string): number | null {
  if (process.platform !== 'win32') return null;
  const normalizedTitle = title.trim().toLowerCase();
  if (!normalizedTitle) return null;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MiyaShellFindWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$target = "${normalizedTitle.replace(/"/g, '""')}"
$found = [uint32]0
$enum = [MiyaShellFindWindow+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $length = [MiyaShellFindWindow]::GetWindowTextLength($hWnd)
  if ($length -le 0) { return $true }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [MiyaShellFindWindow]::GetWindowText($hWnd, $builder, $builder.Capacity) | Out-Null
  $title = $builder.ToString().Trim().ToLowerInvariant()
  if ($title -eq $target) {
    $pid = [uint32]0
    [MiyaShellFindWindow]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
    if ($pid -gt 0) {
      $script:found = $pid
      return $false
    }
  }
  return $true
}
[MiyaShellFindWindow]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($found -gt 0) {
  Write-Output $found
  exit 0
}
exit 1
`.trim();
  try {
    const result = spawnSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf-8',
        timeout: 4_000,
        windowsHide: true,
      },
    );
    if (result.status !== 0) return null;
    const pid = Number(String(result.stdout ?? '').trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

function recoverGatewayShellState(
  workspace: string,
  title = 'miya-gateway',
): GatewayShellState | null {
  const existing = readGatewayShellState(workspace);
  if (existing && isPidAlive(existing.pid)) {
    return existing;
  }

  const discoveredPid = findGatewayShellPidByTitle(title);
  if (discoveredPid === null || discoveredPid <= 0) {
    if (existing) {
      clearGatewayShellState(workspace);
    }
    return null;
  }
  if (!isPidAlive(discoveredPid)) {
    if (existing) {
      clearGatewayShellState(workspace);
    }
    return null;
  }

  const recovered: GatewayShellState = {
    pid: discoveredPid,
    workspace,
    startedAt: existing?.startedAt || new Date().toISOString(),
    visible: existing?.visible ?? true,
  };
  writeGatewayShellState(workspace, recovered);
  return recovered;
}

function resolveGatewayNativeTerminalSourceFile(workspace: string): string {
  const cliScript = resolveCliScriptPath();
  const cliDir = path.dirname(cliScript);
  const candidateRoots = [
    workspace,
    path.join(workspace, 'miya-src'),
    path.resolve(cliDir, '..'),
    path.resolve(cliDir, '..', '..'),
    path.resolve(cliDir, '..', '..', '..'),
  ];
  const dedupedRoots = Array.from(
    new Set(candidateRoots.map((root) => path.resolve(root))),
  );
  for (const root of dedupedRoots) {
    const candidate = path.join(
      root,
      'src',
      'gateway',
      'windows',
      'miya-gateway-terminal.cs',
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(
    workspace,
    'src',
    'gateway',
    'windows',
    'miya-gateway-terminal.cs',
  );
}

function gatewayNativeTerminalBinDir(workspace: string): string {
  return path.join(workspace, '.opencode', 'miya', 'bin');
}

function gatewayNativeTerminalBinaryFile(workspace: string): string {
  return path.join(gatewayNativeTerminalBinDir(workspace), 'miya-gateway-terminal.exe');
}

function resolveCscCompiler(): string | null {
  if (process.platform !== 'win32') return null;
  const windowsDir = process.env.WINDIR?.trim() || 'C:\\Windows';
  const candidates = [
    path.join(
      windowsDir,
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    ),
    path.join(windowsDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
    'csc.exe',
  ];
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate, ['/nologo', '/help'], {
        stdio: 'ignore',
        timeout: 2_000,
        windowsHide: true,
      });
      if (probe.status === 0 || probe.status === 1) return candidate;
    } catch {}
  }
  return null;
}

function ensureNativeGatewayTerminalBinary(workspace: string): {
  ok: boolean;
  binaryPath: string;
  reason?: string;
  detail?: string;
} {
  const sourcePath = resolveGatewayNativeTerminalSourceFile(workspace);
  const binaryPath = gatewayNativeTerminalBinaryFile(workspace);
  if (!fs.existsSync(sourcePath)) {
    return {
      ok: false,
      binaryPath,
      reason: 'native_terminal_source_missing',
      detail: sourcePath,
    };
  }
  const csc = resolveCscCompiler();
  if (!csc) {
    return {
      ok: false,
      binaryPath,
      reason: 'csc_not_found',
      detail:
        'Cannot locate csc.exe (Microsoft .NET Framework compiler). Please install .NET Framework build tools.',
    };
  }

  let needsBuild = !fs.existsSync(binaryPath);
  if (!needsBuild) {
    try {
      const sourceMtime = fs.statSync(sourcePath).mtimeMs;
      const binaryMtime = fs.statSync(binaryPath).mtimeMs;
      needsBuild = sourceMtime > binaryMtime;
    } catch {
      needsBuild = true;
    }
  }
  if (!needsBuild) {
    return { ok: true, binaryPath };
  }

  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  const args = [
    '/nologo',
    '/optimize+',
    '/target:winexe',
    `/out:${binaryPath}`,
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    sourcePath,
  ];
  const result = spawnSync(csc, args, {
    cwd: workspace,
    encoding: 'utf-8',
    timeout: 180_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return {
      ok: false,
      binaryPath,
      reason: 'native_terminal_build_failed',
      detail: detail || `exit_code_${String(result.status ?? 'unknown')}`,
    };
  }
  return { ok: true, binaryPath };
}

function runtimeGatewayFile(cwd: string): string {
  return path.join(cwd, '.opencode', 'miya', 'gateway.json');
}

interface GatewayStartGuard {
  status: 'idle' | 'starting' | 'failed';
  updatedAt: string;
  cooldownUntil?: string;
}

interface GatewayStartResult {
  ok: boolean;
  workspace: string;
  url?: string;
  reason:
    | 'started'
    | 'guard_starting'
    | 'guard_cooldown'
    | 'node_not_found'
    | 'cli_js_not_found'
    | 'spawn_failed'
    | 'start_timeout';
  detail?: string;
}

function runtimeGatewayStartGuardFile(cwd: string): string {
  return path.join(cwd, '.opencode', 'miya', 'gateway-start.guard.json');
}

function readGatewayStartGuard(cwd: string): GatewayStartGuard | null {
  const file = runtimeGatewayStartGuardFile(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as GatewayStartGuard;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      parsed.status !== 'idle' &&
      parsed.status !== 'starting' &&
      parsed.status !== 'failed'
    ) {
      return null;
    }
    if (!parsed.updatedAt || !Number.isFinite(Date.parse(parsed.updatedAt)))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeGatewayStartGuard(cwd: string, guard: GatewayStartGuard): void {
  const file = runtimeGatewayStartGuardFile(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(guard, null, 2)}\n`, 'utf-8');
}

function resolveWorkspaceDir(cwd: string): string {
  const hasRuntimeState = fs.existsSync(path.join(cwd, '.opencode', 'miya'));
  const hasSourceEntry = fs.existsSync(path.join(cwd, 'src', 'index.ts'));
  if (hasRuntimeState || hasSourceEntry) {
    return cwd;
  }
  const nested = path.join(cwd, 'miya-src');
  if (fs.existsSync(path.join(nested, 'src', 'index.ts'))) {
    return nested;
  }
  return cwd;
}

function resolveNodeBinary(): string | null {
  const configured = process.env.MIYA_NODE_BIN?.trim();
  const windowsNodeCandidates =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.ProgramFiles ?? 'C:\\Program Files',
            'nodejs',
            'node.exe',
          ),
          path.join(
            process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
            'nodejs',
            'node.exe',
          ),
          path.join(
            process.env.LOCALAPPDATA ?? '',
            'Programs',
            'nodejs',
            'node.exe',
          ),
        ]
      : [];
  const candidates = [
    configured || null,
    (() => {
      const execBase = path.basename(process.execPath).toLowerCase();
      return execBase === 'node' || execBase === 'node.exe'
        ? process.execPath
        : null;
    })(),
    ...windowsNodeCandidates,
    process.platform === 'win32' ? 'node.exe' : 'node',
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate, ['--version'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 2_000,
        windowsHide: true,
      });
      if (probe.status === 0) return candidate;
    } catch {}
  }
  return null;
}

function resolveCliScriptPath(): string {
  return fileURLToPath(import.meta.url);
}

function clearGatewayStateFile(cwd: string): void {
  try {
    fs.unlinkSync(runtimeGatewayFile(cwd));
  } catch {}
}

function readGatewayUrl(cwd: string): string | null {
  const file = runtimeGatewayFile(cwd);
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      url?: string;
    };
    return parsed.url ?? null;
  } catch {
    return null;
  }
}

function candidateGatewayRuntimeDirs(cwd: string): string[] {
  const workspace = resolveWorkspaceDir(cwd);
  if (workspace === cwd) return [cwd];
  return [workspace, cwd];
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readGatewayState(cwd: string): { url: string; pid: number } | null {
  const file = runtimeGatewayFile(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      url?: unknown;
      pid?: unknown;
    };
    const url = String(parsed.url ?? '').trim();
    const pid = Number(parsed.pid);
    if (!url || !Number.isFinite(pid)) return null;
    return { url, pid };
  } catch {
    return null;
  }
}

async function waitGatewayReady(
  cwd: string,
  timeoutMs = 15000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = readGatewayState(cwd);
    if (state && isPidAlive(state.pid)) {
      try {
        await callGatewayMethod(state.url, 'gateway.status.get', {});
        return true;
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function runGatewayStart(cwd: string): Promise<GatewayStartResult> {
  const workspace = resolveWorkspaceDir(cwd);
  const guard = readGatewayStartGuard(workspace);
  const now = Date.now();
  if (guard?.status === 'starting') {
    const ageMs = now - Date.parse(guard.updatedAt);
    if (ageMs < 30_000) {
      return {
        ok: false,
        workspace,
        reason: 'guard_starting',
        detail: `gateway_start_guard_active ageMs=${ageMs}`,
      };
    }
  }
  if (guard?.cooldownUntil && now < Date.parse(guard.cooldownUntil)) {
    return {
      ok: false,
      workspace,
      reason: 'guard_cooldown',
      detail: `cooldown_until=${guard.cooldownUntil}`,
    };
  }
  writeGatewayStartGuard(workspace, {
    status: 'starting',
    updatedAt: new Date(now).toISOString(),
  });
  const nodeBinary = resolveNodeBinary();
  if (!nodeBinary) {
    writeGatewayStartGuard(workspace, {
      status: 'failed',
      updatedAt: new Date().toISOString(),
      cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    return {
      ok: false,
      workspace,
      reason: 'node_not_found',
      detail: 'Cannot resolve a runnable Node.js binary.',
    };
  }
  const cliRuntime = resolveGatewayCliRuntime(workspace);
  if (!cliRuntime) {
    writeGatewayStartGuard(workspace, {
      status: 'failed',
      updatedAt: new Date().toISOString(),
      cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    return {
      ok: false,
      workspace,
      reason: 'cli_js_not_found',
      detail:
        'Cannot resolve gateway CLI script for node startup (dist or src entry).',
    };
  }
  const nodeArgs = [
    ...(cliRuntime.useTsxLoader ? ['--import', 'tsx'] : []),
    cliRuntime.scriptPath,
    'gateway',
    'serve',
    '--workspace',
    workspace,
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const proc = spawn(nodeBinary, nodeArgs, {
        cwd: workspace,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          MIYA_AUTO_UI_OPEN: '0',
          MIYA_DOCK_AUTO_LAUNCH: '0',
        },
      });
      proc.unref();
    } catch (error) {
      writeGatewayStartGuard(workspace, {
        status: 'failed',
        updatedAt: new Date().toISOString(),
        cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      return {
        ok: false,
        workspace,
        reason: 'spawn_failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (await waitGatewayReady(workspace, 15_000)) {
      writeGatewayStartGuard(workspace, {
        status: 'idle',
        updatedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        workspace,
        url: readGatewayUrl(workspace) ?? undefined,
        reason: 'started',
      };
    }
    clearGatewayStateFile(workspace);
  }

  writeGatewayStartGuard(workspace, {
    status: 'failed',
    updatedAt: new Date().toISOString(),
    cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
  });
  return {
    ok: false,
    workspace,
    reason: 'start_timeout',
    detail: 'Gateway did not become ready within timeout window.',
  };
}

async function callGatewayMethod(
  url: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<unknown> {
  const wsUrl = url.replace(/^http/, 'ws');
  const socket = new WebSocket(`${wsUrl}/ws`);

  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      reject(new Error('gateway_timeout'));
    }, Math.max(400, timeoutMs));

    socket.addEventListener('open', () => {
      const token = process.env.MIYA_GATEWAY_TOKEN;
      socket.send(
        JSON.stringify({
          type: 'hello',
          role: 'admin',
          protocolVersion: '1.0',
          auth: token ? { token } : undefined,
        }),
      );
      socket.send(
        JSON.stringify({
          type: 'request',
          id: 'cli-1',
          method,
          params,
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as {
          type?: string;
          id?: string;
          ok?: boolean;
          result?: unknown;
          error?: { message?: string };
        };

        if (frame.type !== 'response' || frame.id !== 'cli-1') return;
        clearTimeout(timeout);
        socket.close();

        if (frame.ok) {
          resolve(frame.result);
        } else {
          reject(new Error(frame.error?.message ?? 'gateway_method_failed'));
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('gateway_socket_error'));
    });
  });
}

async function ensureGatewayUrl(
  cwd: string,
  autoStart = true,
): Promise<string> {
  const candidateDirs = candidateGatewayRuntimeDirs(cwd);
  for (const dir of candidateDirs) {
    const url = readGatewayUrl(dir);
    if (!url) continue;
    try {
      await callGatewayMethod(url, 'gateway.status.get', {});
      return url;
    } catch {
      clearGatewayStateFile(dir);
    }
  }

  if (autoStart && (await runGatewayStart(cwd)).ok) {
    for (const dir of candidateDirs) {
      const url = readGatewayUrl(dir);
      if (!url) continue;
      try {
        await callGatewayMethod(url, 'gateway.status.get', {});
        return url;
      } catch {
        clearGatewayStateFile(dir);
      }
    }
  }

  throw new Error('gateway_unavailable');
}

async function runGatewayServe(cwd: string, args: string[]): Promise<number> {
  const workspace =
    readFlagValue(args, '--workspace') ?? resolveWorkspaceDir(cwd);
  const { ensureGatewayRunning, stopGateway } = await import('../gateway');
  const removeCrashGuards = installGatewayCrashGuards('gateway.serve', {
    exitOnFatal: true,
    fatalExitCode: 1,
    onEvent: (event) => {
      if (event.severity === 'non_fatal') {
        log('[gateway] suppressed non-fatal unhandled process error', {
          context: event.context,
          reason: event.reasonText,
        });
        return;
      }
      log('[gateway] fatal unhandled process error', {
        context: event.context,
        reason: event.reasonText,
      });
      console.error(`[gateway] ${event.context}: ${event.reasonText}`);
    },
  });

  try {
    try {
      const state = ensureGatewayRunning(workspace);
      console.log(JSON.stringify(state, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'gateway_owned_by_other_process') {
        return 0;
      }
      throw error;
    }

    await new Promise<void>((resolve) => {
      const stop = () => {
        try {
          stopGateway(workspace);
        } finally {
          resolve();
        }
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });

    return 0;
  } finally {
    removeCrashGuards();
  }
}

function resolveMiyaVersion(workspace: string): string {
  const pkg = path.join(workspace, 'package.json');
  if (!fs.existsSync(pkg)) return '0.0.0';
  try {
    const parsed = JSON.parse(fs.readFileSync(pkg, 'utf-8')) as {
      version?: unknown;
    };
    const version = String(parsed.version ?? '').trim();
    return version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function resolveGitCommitShort(workspace: string): string {
  try {
    const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: workspace,
      encoding: 'utf-8',
      timeout: 2_000,
      windowsHide: true,
    });
    if (result.status !== 0) return 'unknown';
    const commit = String(result.stdout ?? '').trim();
    return commit || 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseGatewayWsEndpoints(state: { url: string }): string[] {
  try {
    const parsed = new URL(state.url);
    const port = parsed.port || '80';
    const wsPath = '/ws';
    const protocol = parsed.protocol === 'https:' ? 'wss' : 'ws';
    const host = parsed.hostname;
    const endpoints = new Set<string>();
    endpoints.add(`${protocol}://${host}:${port}${wsPath}`);
    if (host === '127.0.0.1') {
      endpoints.add(`${protocol}://[::1]:${port}${wsPath}`);
    }
    return Array.from(endpoints);
  } catch {
    return [];
  }
}

function printGatewayCommandResult(label: string, payload: unknown): void {
  printGatewayTerminalEvent('gateway', `${label}:`, 'link');
  const text = JSON.stringify(payload, null, 2)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n');
  if (!text) return;
  const colored = color(text, ANSI.blue);
  process.stdout.write(`${colored}\n`);
}

const TERMINAL_HOST_EXIT_GATEWAY_STOPPED = 51;

async function executeGatewayTerminalCommand(params: {
  workspace: string;
  gatewayUrl: string;
  commandLine: string;
}): Promise<{ gatewayUrl: string; exit: boolean; exitCode?: number }> {
  const command = params.commandLine.trim();
  if (!command) return { gatewayUrl: params.gatewayUrl, exit: false };

  if (command === 'help' || command === '?') {
    printGatewayTerminalEvent(
      'gateway',
      'commands: status | doctor | start | stop | shutdown | restart | raw <method> [json] | clear',
      'link',
    );
    return { gatewayUrl: params.gatewayUrl, exit: false };
  }

  if (command === 'clear') {
    process.stdout.write('\x1bc');
    return { gatewayUrl: params.gatewayUrl, exit: false };
  }

  if (command === 'exit' || command === 'quit') {
    printGatewayTerminalEvent(
      'gateway',
      'exit disabled in persistent mode. Use window close button to hide, or run shutdown to stop gateway.',
      'warn',
    );
    return { gatewayUrl: params.gatewayUrl, exit: false };
  }

  let gatewayUrl = params.gatewayUrl;
  const requiresLiveGateway =
    command !== 'start' && command !== 'clear' && command !== 'help' && command !== '?';
  if (requiresLiveGateway) {
    try {
      await callGatewayMethod(gatewayUrl, 'gateway.status.get', {}, 1_200);
    } catch {
      gatewayUrl = await ensureGatewayUrl(params.workspace, false);
    }
  }

  if (command === 'start') {
    const started = await runGatewayStart(params.workspace);
    if (!started.ok) {
      printGatewayTerminalEvent(
        'gateway',
        `start failed: ${started.reason}${started.detail ? ` (${started.detail})` : ''}`,
        'error',
      );
      return { gatewayUrl: params.gatewayUrl, exit: false };
    }
    const nextGatewayUrl = await ensureGatewayUrl(params.workspace, true);
    printGatewayTerminalEvent('gateway', `gateway started: ${nextGatewayUrl}`);
    return { gatewayUrl: nextGatewayUrl, exit: false };
  }

  if (command === 'restart') {
    try {
      await callGatewayMethod(gatewayUrl, 'gateway.shutdown', {});
    } catch {}
    const started = await runGatewayStart(params.workspace);
    if (!started.ok) {
      printGatewayTerminalEvent(
        'gateway',
        `restart failed: ${started.reason}${started.detail ? ` (${started.detail})` : ''}`,
        'error',
      );
      return { gatewayUrl, exit: false };
    }
    const nextGatewayUrl = await ensureGatewayUrl(params.workspace, true);
    printGatewayTerminalEvent('gateway', `gateway restarted: ${nextGatewayUrl}`);
    return { gatewayUrl: nextGatewayUrl, exit: false };
  }

  if (command === 'stop' || command === 'shutdown') {
    const result = await callGatewayMethod(gatewayUrl, 'gateway.shutdown', {});
    printGatewayCommandResult('shutdown', result);
    printGatewayTerminalEvent(
      'gateway',
      'gateway stopped; terminal host exiting to close window.',
      'warn',
    );
    return {
      gatewayUrl,
      exit: true,
      exitCode: TERMINAL_HOST_EXIT_GATEWAY_STOPPED,
    };
  }

  if (command === 'status') {
    const result = await callGatewayMethod(gatewayUrl, 'gateway.status.get', {});
    printGatewayCommandResult('status', result);
    return { gatewayUrl, exit: false };
  }

  if (command === 'doctor') {
    const result = await callGatewayMethod(gatewayUrl, 'doctor.run', {});
    printGatewayCommandResult('doctor', result);
    return { gatewayUrl, exit: false };
  }

  if (command.startsWith('raw ')) {
    const raw = command.slice('raw '.length).trim();
    const firstSpace = raw.indexOf(' ');
    const method = (firstSpace >= 0 ? raw.slice(0, firstSpace) : raw).trim();
    const paramsRaw = firstSpace >= 0 ? raw.slice(firstSpace + 1).trim() : '';
    let methodParams: Record<string, unknown> = {};
    if (paramsRaw) {
      try {
        const parsed = JSON.parse(paramsRaw) as unknown;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed)
        ) {
          throw new Error('raw_method_params_must_be_object');
        }
        methodParams = parsed as Record<string, unknown>;
      } catch (error) {
        printGatewayTerminalEvent(
          'gateway',
          `raw command params parse failed: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
        return { gatewayUrl, exit: false };
      }
    }
    if (!method) {
      printGatewayTerminalEvent('gateway', 'raw command requires method name', 'warn');
      return { gatewayUrl, exit: false };
    }
    const result = await callGatewayMethod(
      gatewayUrl,
      method,
      methodParams,
    );
    printGatewayCommandResult(`raw ${method}`, result);
    return { gatewayUrl, exit: false };
  }

  printGatewayTerminalEvent(
    'gateway',
    `unknown command: ${command} (type "help")`,
    'warn',
  );
  return { gatewayUrl, exit: false };
}

async function runGatewayTerminalHost(
  cwd: string,
  args: string[],
  input?: { useLock?: boolean; replayAllLogs?: boolean },
): Promise<number> {
  const removeCrashGuards = installGatewayCrashGuards('gateway.terminal-host', {
    exitOnFatal: false,
    onEvent: (event) => {
      if (event.severity === 'non_fatal') {
        log('[gateway] terminal host suppressed non-fatal process error', {
          context: event.context,
          reason: event.reasonText,
        });
        printGatewayTerminalEvent(
          'gateway',
          `non-fatal runtime error suppressed: ${event.reasonText}`,
          'warn',
        );
        return;
      }
      log('[gateway] terminal host caught fatal process error and continued', {
        context: event.context,
        reason: event.reasonText,
      });
      printGatewayTerminalEvent(
        'gateway',
        `fatal runtime error caught (process kept alive): ${event.reasonText}`,
        'error',
      );
    },
  });

  const workspace =
    readFlagValue(args, '--workspace') ?? resolveWorkspaceDir(cwd);
  const useLock = input?.useLock !== false;
  const replayAllLogs = input?.replayAllLogs !== false;
  let hasLock = false;
  if (useLock) {
    const lock = acquireTerminalLock(workspace);
    if (!lock.ok) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            skipped: true,
            reason: 'terminal_already_running',
            ownerPid: lock.ownerPid ?? null,
          },
          null,
          2,
        ),
      );
      removeCrashGuards();
      return 0;
    }
    hasLock = true;
  }

  let gatewayUrl = '';
  try {
    gatewayUrl = await ensureGatewayUrl(workspace, true);
  } catch (error) {
    printGatewayTerminalEvent(
      'gateway',
      `gateway attach degraded: ${error instanceof Error ? error.message : String(error)}`,
      'warn',
    );
  }
  const state = readGatewayState(workspace);
  if (!gatewayUrl && state?.url) {
    gatewayUrl = state.url;
  }
  if (!gatewayUrl) {
    gatewayUrl = 'http://127.0.0.1:0';
  }
  const logFile = gatewayLogFilePath();
  const version = resolveMiyaVersion(workspace);
  const commit = resolveGitCommitShort(workspace);
  let snapshot: Record<string, unknown> | null = null;
  if (!gatewayUrl.endsWith(':0')) {
    try {
      const statusResult = await callGatewayMethod(
        gatewayUrl,
        'gateway.status.get',
        {},
      );
      if (isRecord(statusResult)) snapshot = statusResult;
    } catch (error) {
      printGatewayTerminalEvent(
        'gateway',
        `status preload degraded: ${error instanceof Error ? error.message : String(error)}`,
        'warn',
      );
    }
  }

  printGatewayTerminalEvent(
    'gateway',
    `Miya ${version} (${commit}) - Because texting yourself reminders is so 2024.`,
    'link',
  );
  const canvasUrl = `${gatewayUrl}/__miya__/canvas/`;
  printGatewayTerminalEvent(
    'canvas',
    `host mounted at ${canvasUrl} (root ${workspace})`,
    'link',
  );
  printGatewayTerminalEvent(
    'heartbeat',
    'started',
    'info',
  );
  const runtimeState = snapshot?.runtime;
  const activeAgent =
    isRecord(runtimeState) && typeof runtimeState.activeAgentId === 'string'
      ? runtimeState.activeAgentId
      : 'unknown';
  printGatewayTerminalEvent('gateway', `agent model: ${activeAgent}`);
  const gatewaySnapshot = isRecord(snapshot?.gateway) ? snapshot.gateway : null;
  const gatewayPidFromSnapshot =
    gatewaySnapshot && Number.isFinite(Number(gatewaySnapshot.pid))
      ? Number(gatewaySnapshot.pid)
      : process.pid;
  const endpointState = state ?? {
    url: gatewayUrl,
    pid: gatewayPidFromSnapshot,
  };
  if (endpointState.url.endsWith(':0')) {
    printGatewayTerminalEvent(
      'gateway',
      'gateway endpoint unresolved; run "start" after checking local Node runtime.',
      'warn',
    );
  } else {
    const wsEndpoints = parseGatewayWsEndpoints(endpointState);
    for (const endpoint of wsEndpoints) {
      printGatewayTerminalEvent(
        'gateway',
        `listening on ${endpoint}${
          endpoint.includes('127.0.0.1')
            ? ` (PID ${endpointState.pid})`
            : ''
        }`,
        'link',
      );
    }
  }
  printGatewayTerminalEvent('gateway', `log file: ${logFile}`, 'link');
  const daemonSnapshot = isRecord(snapshot?.daemon) ? snapshot.daemon : null;
  const daemon =
    daemonSnapshot && typeof daemonSnapshot.statusText === 'string'
      ? daemonSnapshot.statusText
      : 'unknown';
  const daemonConnected = daemonSnapshot ? Boolean(daemonSnapshot.connected) : false;
  printGatewayTerminalEvent(
    'browser/service',
    `Browser control service ${daemonConnected ? 'ready' : 'degraded'} (${daemon})`,
    daemonConnected ? 'info' : 'warn',
  );
  printGatewayTerminalEvent('gateway', 'stdin interactive enabled');
  printGatewayTerminalEvent('gateway', 'type "help" for terminal commands', 'link');

  if (replayAllLogs) {
    const historicalLines = readAllLogLines(logFile);
    if (historicalLines.length === 0) {
      printGatewayTerminalEvent('gateway', 'waiting for runtime log stream...');
    } else {
      for (const line of historicalLines) {
        console.log(formatGatewayConsoleLine(line));
      }
    }
  }

  const stopTail = startGatewayLogTail(
    logFile,
    (line) => {
      console.log(formatGatewayConsoleLine(line));
    },
    { startAt: 'end' },
  );

  let terminalExitCode = 0;
  let shouldExit = false;
  let rl: readline.Interface | null = null;
  let resolveNonTtyExit: (() => void) | null = null;
  let staleGatewayPidStrikes = 0;

  const requestExit = (exitCode: number): void => {
    if (shouldExit) return;
    shouldExit = true;
    terminalExitCode = exitCode;
    if (rl) {
      rl.close();
      return;
    }
    if (resolveNonTtyExit) {
      resolveNonTtyExit();
    }
  };

  const gatewayLivenessTimer = setInterval(() => {
    if (shouldExit) return;
    const latest = readGatewayState(workspace);
    if (!latest) {
      staleGatewayPidStrikes = 0;
      return;
    }
    if (isPidAlive(latest.pid)) {
      staleGatewayPidStrikes = 0;
      return;
    }
    staleGatewayPidStrikes += 1;
    if (staleGatewayPidStrikes < 3) {
      return;
    }
    printGatewayTerminalEvent(
      'gateway',
      `gateway pid ${latest.pid} is offline; terminal host exiting.`,
      'warn',
    );
    requestExit(TERMINAL_HOST_EXIT_GATEWAY_STOPPED);
  }, 1_200);

  const cleanup = (): void => {
    clearInterval(gatewayLivenessTimer);
    stopTail();
    removeCrashGuards();
    if (hasLock) {
      releaseTerminalLock(workspace);
    }
  };

  if (!process.stdin.isTTY) {
    await new Promise<void>((resolve) => {
      resolveNonTtyExit = resolve;
      const stop = () => requestExit(0);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    cleanup();
    return terminalExitCode;
  }

  const prompt = color('miya-gateway> ', ANSI.blue);
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 500,
    removeHistoryDuplicates: true,
  });
  rl.setPrompt(prompt);

  let queue = Promise.resolve<{
    gatewayUrl: string;
    exit: boolean;
    exitCode?: number;
  }>({
    gatewayUrl,
    exit: false,
  });
  rl.prompt();

  rl.on('line', (line) => {
    queue = queue
      .then((result) =>
        executeGatewayTerminalCommand({
          workspace,
          gatewayUrl: result.gatewayUrl,
          commandLine: line,
        }),
      )
      .then((result) => {
        gatewayUrl = result.gatewayUrl;
        if (result.exit) {
          requestExit(result.exitCode ?? 0);
          return result;
        }
        if (!shouldExit) {
          rl.prompt();
        }
        return result;
      })
      .catch((error) => {
        printGatewayTerminalEvent(
          'gateway',
          `command failed: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
        if (!shouldExit) {
          rl.prompt();
        }
        return { gatewayUrl, exit: false };
      });
  });

  await new Promise<void>((resolve) => {
    const stop = () => {
      requestExit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    rl.once('close', () => resolve());
  });

  cleanup();
  return terminalExitCode;
}

async function runGatewayShell(
  cwd: string,
  args: string[],
): Promise<number> {
  if (process.platform !== 'win32') {
    console.error('gateway_shell_unsupported_platform');
    return 2;
  }
  const action = (args[0] ?? 'status').trim().toLowerCase();
  const workspace =
    readFlagValue(args, '--workspace') ?? resolveWorkspaceDir(cwd);
  const state = recoverGatewayShellState(workspace);
  const alive = state ? isPidAlive(state.pid) : false;

  if (action === 'status') {
    console.log(
      JSON.stringify(
        {
          ok: true,
          action,
          running: Boolean(state && alive),
          pid: state?.pid ?? null,
          visible: state?.visible ?? null,
          workspace,
          stateFile: gatewayShellStateFile(workspace),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (action === 'stop' || action === 'shutdown') {
    const latest = recoverGatewayShellState(workspace);
    if (!latest || !isPidAlive(latest.pid)) {
      clearGatewayShellState(workspace);
      console.log(
        JSON.stringify({ ok: true, action: 'stop', stopped: false }, null, 2),
      );
      return 0;
    }
    try {
      process.kill(latest.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(latest.pid, 'SIGKILL');
      } catch {}
    }
    clearGatewayShellState(workspace);
    console.log(
      JSON.stringify(
        { ok: true, action: 'stop', stopped: true, pid: latest.pid },
        null,
        2,
      ),
    );
    return 0;
  }

  if (action === 'start') {
    const current = recoverGatewayShellState(workspace);
    if (current && isPidAlive(current.pid)) {
      setWindowVisibleByPid(current.pid, true);
      writeGatewayShellState(workspace, {
        ...current,
        visible: true,
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            action,
            started: false,
            reason: 'already_running',
            pid: current.pid,
            visible: true,
          },
          null,
          2,
        ),
      );
      return 0;
    }
    const launchGuardAgeMs = readGatewayShellLaunchGuardAgeMs(workspace);
    if (launchGuardAgeMs !== null && launchGuardAgeMs < 15_000) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            action,
            started: false,
            reason: 'shell_start_in_progress',
            ageMs: Math.max(0, Math.floor(launchGuardAgeMs)),
          },
          null,
          2,
        ),
      );
      return 0;
    }
    writeGatewayShellLaunchGuard(workspace);
    try {
    let gatewayReady = false;
    try {
      await ensureGatewayUrl(workspace, false);
      gatewayReady = true;
    } catch {}
    if (!gatewayReady) {
      const started = await runGatewayStart(workspace);
      if (!started.ok && started.reason === 'guard_starting') {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        try {
          await ensureGatewayUrl(workspace, false);
          gatewayReady = true;
        } catch {}
      } else if (started.ok) {
        gatewayReady = true;
      }
      if (!gatewayReady) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              action,
              started: false,
              reason: started.reason,
              detail: started.detail ?? null,
            },
            null,
            2,
          ),
        );
        return 1;
      }
    }
    const nodeBinary = resolveNodeBinary();
    const cliRuntime = resolveGatewayCliRuntime(workspace);
    if (!nodeBinary || !cliRuntime) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            started: false,
            reason: 'node_or_cli_not_found',
          },
          null,
          2,
        ),
      );
      return 1;
    }
    const native = ensureNativeGatewayTerminalBinary(workspace);
    if (!native.ok) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            started: false,
            reason: native.reason ?? 'native_terminal_unavailable',
            detail: native.detail ?? null,
            binaryPath: native.binaryPath,
          },
          null,
          2,
        ),
      );
      return 1;
    }
    const shell = spawn(
      native.binaryPath,
      [
        '--workspace',
        workspace,
        '--node',
        nodeBinary,
        '--cli',
        cliRuntime.scriptPath,
        '--tsx',
        cliRuntime.useTsxLoader ? '1' : '0',
      ],
      {
        cwd: workspace,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    );
    shell.unref();
    const shellPid = shell.pid ?? 0;
    if (!Number.isFinite(shellPid) || shellPid <= 0) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            started: false,
            reason: 'shell_pid_unavailable',
          },
          null,
          2,
        ),
      );
      return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (!isPidAlive(shellPid)) {
      const recovered = recoverGatewayShellState(workspace);
      if (recovered && isPidAlive(recovered.pid)) {
        setWindowVisibleByPid(recovered.pid, true);
        writeGatewayShellState(workspace, {
          ...recovered,
          visible: true,
        });
        console.log(
          JSON.stringify(
            {
              ok: true,
              action,
              started: false,
              reason: 'reused_existing',
              pid: recovered.pid,
              workspace,
            },
            null,
            2,
          ),
        );
        return 0;
      }
      clearGatewayShellState(workspace);
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            started: false,
            reason: 'shell_exit_early',
            pid: shellPid,
            detail:
              'native terminal process exited immediately; check desktop session/ConPTY availability',
          },
          null,
          2,
        ),
      );
      return 1;
    }
    const next: GatewayShellState = {
      pid: shellPid,
      workspace,
      startedAt: new Date().toISOString(),
      visible: true,
    };
    writeGatewayShellState(workspace, next);
      console.log(
        JSON.stringify(
          {
            ok: true,
            action,
            started: true,
            pid: shellPid,
            workspace,
            binaryPath: native.binaryPath,
          },
          null,
          2,
        ),
      );
    return 0;
    } finally {
      clearGatewayShellLaunchGuard(workspace);
    }
  }

  if (action === 'show' || action === 'hide' || action === 'toggle') {
    const current = recoverGatewayShellState(workspace);
    if (!current || !isPidAlive(current.pid)) {
      clearGatewayShellState(workspace);
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            reason: 'shell_not_running',
            workspace,
          },
          null,
          2,
        ),
      );
      return 1;
    }
    const shouldShow =
      action === 'show'
        ? true
        : action === 'hide'
          ? false
          : !current.visible;
    const changed = setWindowVisibleByPid(current.pid, shouldShow);
    if (!changed) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            reason: 'window_visibility_change_failed',
            pid: current.pid,
          },
          null,
          2,
        ),
      );
      return 1;
    }
    current.visible = shouldShow;
    writeGatewayShellState(workspace, current);
    console.log(
      JSON.stringify(
        {
          ok: true,
          action,
          pid: current.pid,
          visible: shouldShow,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  throw new Error(`unknown_gateway_shell_action:${action}`);
}

async function runGatewayAutostart(
  cwd: string,
  args: string[],
): Promise<number> {
  const action = args[0] ?? 'status';
  const workspace =
    readFlagValue(args, '--workspace') ?? resolveWorkspaceDir(cwd);
  const modeRaw = (readFlagValue(args, '--mode') ?? 'service_shell')
    .trim()
    .toLowerCase();
  const mode: 'serve' | 'service_shell' =
    modeRaw === 'serve' ? 'serve' : 'service_shell';
  const startupDir = windowsStartupDir();
  if (!startupDir) {
    console.error('gateway_autostart_unsupported_platform');
    return 2;
  }
  const legacyScriptFile = gatewayAutostartScriptPath();
  const startupVbs = gatewayAutostartVbsPath();
  const launcherFile = gatewayAutostartLauncherPath(workspace);
  const metaFile = gatewayAutostartMetaFile(workspace);
  if (!startupVbs) {
    console.error('gateway_autostart_startup_dir_unavailable');
    return 2;
  }

  if (action === 'status') {
    const exists = fs.existsSync(startupVbs);
    const launcherExists = fs.existsSync(launcherFile);
    const legacyExists = fs.existsSync(legacyScriptFile);
    console.log(
      JSON.stringify(
        {
          ok: true,
          action,
          exists,
          launcherExists,
          legacyExists,
          mode: readAutostartMode(workspace),
          startupDir,
          startupVbs,
          launcherFile,
          workspace,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (action === 'remove' || action === 'uninstall') {
    const existed =
      fs.existsSync(startupVbs) ||
      fs.existsSync(launcherFile) ||
      fs.existsSync(legacyScriptFile);
    try {
      fs.unlinkSync(startupVbs);
    } catch {}
    try {
      fs.unlinkSync(launcherFile);
    } catch {}
    try {
      fs.unlinkSync(metaFile);
    } catch {}
    try {
      fs.unlinkSync(legacyScriptFile);
    } catch {}
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: 'remove',
          removed: existed,
          startupVbs,
          launcherFile,
          legacyScriptFile,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (action === 'install') {
    const nodeBinary = resolveNodeBinary();
    if (!nodeBinary) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            reason: 'node_not_found',
            detail: 'Cannot resolve a runnable Node.js binary.',
          },
          null,
          2,
        ),
      );
      return 1;
    }
    const cliRuntime = resolveGatewayCliRuntime(workspace);
    if (!cliRuntime) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            action,
            reason: 'cli_js_not_found',
            detail:
              'Cannot resolve gateway CLI script for autostart (dist or src entry).',
          },
          null,
          2,
        ),
      );
      return 1;
    }
    const scriptText = renderGatewayAutostartScript({
      workspace,
      nodeBinary,
      cliRuntime,
      mode,
    });
    if (!fs.existsSync(path.dirname(launcherFile))) {
      fs.mkdirSync(path.dirname(launcherFile), { recursive: true });
    }
    fs.writeFileSync(launcherFile, scriptText, 'utf-8');
    fs.writeFileSync(
      startupVbs,
      renderGatewayAutostartVbs(launcherFile),
      'utf-8',
    );
    fs.writeFileSync(
      metaFile,
      `${JSON.stringify(
        {
          mode,
          installedAt: new Date().toISOString(),
          launcherFile,
          startupVbs,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    try {
      fs.unlinkSync(legacyScriptFile);
    } catch {}
    console.log(
      JSON.stringify(
        {
          ok: true,
          action,
          installed: true,
          mode,
          startupVbs,
          launcherFile,
          startupDir,
          workspace,
          nodeBinary,
          cliScript: cliRuntime.scriptPath,
          cliLoader: cliRuntime.useTsxLoader ? 'tsx' : 'node',
        },
        null,
        2,
      ),
    );
    return 0;
  }

  throw new Error(`unknown_gateway_autostart_action:${action}`);
}

async function runGatewayCommand(cwd: string, args: string[]): Promise<number> {
  const action = args[0] ?? 'status';

  if (action === 'start') {
    const allowCliStart =
      args.includes('--force') ||
      process.env.MIYA_GATEWAY_CLI_START_ENABLE === '1';
    if (!allowCliStart) {
      console.error(
        'gateway_start_blocked:safety_guard (use `miya gateway start --force` or set MIYA_GATEWAY_CLI_START_ENABLE=1)',
      );
      return 2;
    }
    const result = await runGatewayStart(cwd);
    const output = {
      ok: result.ok,
      reason: result.reason,
      workspace: result.workspace,
      url: result.url ?? null,
      detail: result.detail ?? null,
    };
    console.log(JSON.stringify(output, null, 2));
    return result.ok ? 0 : 1;
  }
  if (action === 'serve') {
    return await runGatewayServe(cwd, args.slice(1));
  }
  if (action === 'terminal-host') {
    return await runGatewayTerminalHost(cwd, args.slice(1), {
      useLock: false,
      replayAllLogs: true,
    });
  }
  if (action === 'shell') {
    return await runGatewayShell(cwd, args.slice(1));
  }
  if (action === 'autostart') {
    return await runGatewayAutostart(cwd, args.slice(1));
  }

  let url = '';
  try {
    url = await ensureGatewayUrl(cwd, false);
  } catch (error) {
    if (action === 'shutdown') {
      console.log(
        JSON.stringify(
          { ok: true, stopped: false, reason: 'not_running' },
          null,
          2,
        ),
      );
      return 0;
    }
    throw error;
  }
  if (action === 'status') {
    const result = await callGatewayMethod(url, 'gateway.status.get', {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === 'doctor') {
    const result = await callGatewayMethod(url, 'doctor.run', {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === 'shutdown') {
    const result = await callGatewayMethod(url, 'gateway.shutdown', {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  throw new Error(`unknown_gateway_action:${action}`);
}

async function runSubcommand(
  cwd: string,
  top: string,
  args: string[],
): Promise<number> {
  const url = await ensureGatewayUrl(cwd);
  const workspace = resolveWorkspaceDir(cwd);
  const withPolicyHash = (
    params: Record<string, unknown>,
  ): Record<string, unknown> => ({
    ...params,
    policyHash: currentPolicyHash(workspace),
  });

  const method = (() => {
    if (top === 'sessions') {
      const action = args[0] ?? 'list';
      if (action === 'list') return ['sessions.list', {}] as const;
      if (action === 'get')
        return ['sessions.get', { sessionID: args[1] }] as const;
      if (action === 'send')
        return [
          'sessions.send',
          {
            sessionID: args[1],
            text: args[2],
            source: args[3] ?? 'cli',
          },
        ] as const;
      if (action === 'policy')
        return [
          'sessions.policy.set',
          {
            sessionID: args[1],
            activation: args[2],
            reply: args[3],
          },
        ] as const;
    }

    if (top === 'channels') {
      const action = args[0] ?? 'status';
      if (action === 'list') return ['channels.list', {}] as const;
      if (action === 'status') return ['channels.status', {}] as const;
      if (action === 'pairs')
        return ['channels.pair.list', { status: args[1] }] as const;
      if (action === 'approve')
        return ['channels.pair.approve', { pairID: args[1] }] as const;
      if (action === 'reject')
        return ['channels.pair.reject', { pairID: args[1] }] as const;
      if (action === 'send')
        return [
          'channels.message.send',
          {
            channel: args[1],
            destination: args[2],
            text: args[3],
            sessionID: args[4] ?? 'main',
          },
        ] as const;
    }

    if (top === 'nodes') {
      const action = args[0] ?? 'status';
      if (action === 'list') return ['nodes.list', {}] as const;
      if (action === 'status') return ['nodes.status', {}] as const;
      if (action === 'describe')
        return ['nodes.describe', { nodeID: args[1] }] as const;
      if (action === 'pairs')
        return ['nodes.pair.list', { status: args[1] }] as const;
      if (action === 'approve')
        return ['nodes.pair.approve', { pairID: args[1] }] as const;
      if (action === 'reject')
        return ['nodes.pair.reject', { pairID: args[1] }] as const;
      if (action === 'invoke')
        return [
          'nodes.invoke',
          {
            nodeID: args[1],
            capability: args[2],
            args: args[3] ? JSON.parse(args[3]) : {},
            sessionID: args[4] ?? 'main',
          },
        ] as const;
    }

    if (top === 'skills') {
      const action = args[0] ?? 'status';
      if (action === 'status') return ['skills.status', {}] as const;
      if (action === 'enable')
        return ['skills.enable', { skillID: args[1] }] as const;
      if (action === 'disable')
        return ['skills.disable', { skillID: args[1] }] as const;
      if (action === 'install')
        return [
          'skills.install',
          withPolicyHash({
            repo: args[1],
            targetName: args[2],
            sessionID: args[3] ?? 'main',
          }),
        ] as const;
      if (action === 'update')
        return [
          'skills.update',
          withPolicyHash({
            dir: args[1],
            sessionID: args[2] ?? 'main',
          }),
        ] as const;
    }

    if (top === 'sync') {
      const action = args[0] ?? 'list';
      if (action === 'list') return ['miya.sync.list', {}] as const;
      if (action === 'diff')
        return ['miya.sync.diff', { sourcePackID: args[1] }] as const;
      if (action === 'pull')
        return [
          'miya.sync.pull',
          withPolicyHash({
            sourcePackID: args[1],
            sessionID: args[2] ?? 'main',
          }),
        ] as const;
      if (action === 'apply')
        return [
          'miya.sync.apply',
          withPolicyHash({
            sourcePackID: args[1],
            revision: args[2],
            sessionID: args[3] ?? 'main',
          }),
        ] as const;
      if (action === 'rollback')
        return [
          'miya.sync.rollback',
          withPolicyHash({
            sourcePackID: args[1],
            sessionID: args[2] ?? 'main',
          }),
        ] as const;
    }

    if (top === 'cron') {
      const action = args[0] ?? 'list';
      if (action === 'list') return ['cron.list', {}] as const;
      if (action === 'runs')
        return ['cron.runs.list', { limit: Number(args[1] ?? 50) }] as const;
      if (action === 'add')
        return [
          'cron.add',
          {
            name: args[1],
            time: args[2],
            command: args[3],
            requireApproval: args[4] === 'true',
          },
        ] as const;
      if (action === 'run')
        return ['cron.run.now', { jobID: args[1] }] as const;
      if (action === 'remove')
        return ['cron.remove', { jobID: args[1] }] as const;
      if (action === 'approvals') return ['cron.approvals.list', {}] as const;
      if (action === 'approve')
        return ['cron.approvals.approve', { approvalID: args[1] }] as const;
      if (action === 'reject')
        return ['cron.approvals.reject', { approvalID: args[1] }] as const;
    }

    if (top === 'voice') {
      const action = args[0] ?? 'status';
      if (action === 'status') return ['voice.status', {}] as const;
      if (action === 'wake-on') return ['voice.wake.enable', {}] as const;
      if (action === 'wake-off') return ['voice.wake.disable', {}] as const;
      if (action === 'talk-start')
        return ['voice.talk.start', { sessionID: args[1] }] as const;
      if (action === 'talk-stop') return ['voice.talk.stop', {}] as const;
      if (action === 'ingest')
        return [
          'voice.input.ingest',
          {
            text: args[1],
            mediaID: args[2],
            source: args[3] ?? 'manual',
            sessionID: args[4] ?? 'main',
          },
        ] as const;
      if (action === 'history')
        return [
          'voice.history.list',
          { limit: Number(args[1] ?? 50) },
        ] as const;
      if (action === 'clear') return ['voice.history.clear', {}] as const;
    }

    if (top === 'canvas') {
      const action = args[0] ?? 'status';
      if (action === 'status') return ['canvas.status', {}] as const;
      if (action === 'list') return ['canvas.list', {}] as const;
      if (action === 'get') return ['canvas.get', { docID: args[1] }] as const;
      if (action === 'open')
        return [
          'canvas.open',
          {
            title: args[1],
            type: args[2] ?? 'markdown',
            content: args[3] ?? '',
          },
        ] as const;
      if (action === 'render')
        return [
          'canvas.render',
          {
            docID: args[1],
            content: args[2],
            merge: args[3] === 'true',
          },
        ] as const;
      if (action === 'close')
        return ['canvas.close', { docID: args[1] }] as const;
    }

    if (top === 'companion') {
      const action = args[0] ?? 'status';
      if (action === 'status') return ['companion.status', {}] as const;
      if (action === 'wizard') return ['companion.wizard.start', {}] as const;
      if (action === 'profile')
        return [
          'companion.profile.update',
          {
            name: args[1],
            relationship: args[2],
            persona: args[3],
            style: args[4],
            enabled: args[5] === 'true',
          },
        ] as const;
      if (action === 'memory-add')
        return ['companion.memory.add', { fact: args[1] }] as const;
      if (action === 'memory-list')
        return ['companion.memory.list', {}] as const;
      if (action === 'asset-add')
        return [
          'companion.asset.add',
          {
            type: args[1],
            pathOrUrl: args[2],
            label: args[3],
          },
        ] as const;
      if (action === 'asset-list') return ['companion.asset.list', {}] as const;
      if (action === 'reset') return ['companion.reset', {}] as const;
    }

    return null;
  })();

  if (!method) {
    throw new Error(`unknown_subcommand:${top}`);
  }

  const [methodName, params] = method;
  const result = await callGatewayMethod(url, methodName, params);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

function readFlagValue(args: string[], key: string): string | undefined {
  const direct = args.find((item) => item.startsWith(`${key}=`));
  if (direct) return direct.slice(key.length + 1);
  const index = args.indexOf(key);
  if (index >= 0 && index < args.length - 1) {
    return args[index + 1];
  }
  return undefined;
}

async function runNodeHostCommand(
  cwd: string,
  args: string[],
): Promise<number> {
  const gateway =
    readFlagValue(args, '--gateway') ?? (await ensureGatewayUrl(cwd));
  const nodeID = readFlagValue(args, '--node-id');
  const deviceID = readFlagValue(args, '--device-id');
  const capabilitiesValue = readFlagValue(args, '--capabilities');
  const capabilities = capabilitiesValue
    ? capabilitiesValue
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;

  await runNodeHost({
    projectDir: cwd,
    gatewayUrl: gateway,
    nodeID,
    deviceID,
    capabilities,
  });
  return 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();

  if (args.length === 0 || args[0] === 'install') {
    const installArgs = parseInstallArgs(
      args.slice(args[0] === 'install' ? 1 : 0),
    );
    const exitCode = await install(installArgs);
    process.exit(exitCode);
  }

  if (args[0] === '-h' || args[0] === '--help') {
    printHelp();
    process.exit(0);
  }

  if (args[0] === 'gateway') {
    const exitCode = await runGatewayCommand(cwd, args.slice(1));
    process.exit(exitCode);
  }

  if (args[0] === 'node-host') {
    const exitCode = await runNodeHostCommand(cwd, args.slice(1));
    process.exit(exitCode);
  }

  const top = args[0];
  if (
    top === 'sessions' ||
    top === 'channels' ||
    top === 'nodes' ||
    top === 'skills' ||
    top === 'sync' ||
    top === 'cron' ||
    top === 'voice' ||
    top === 'canvas' ||
    top === 'companion'
  ) {
    const exitCode = await runSubcommand(cwd, top, args.slice(1));
    process.exit(exitCode);
  }

  throw new Error(`unknown_command:${args[0]}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
