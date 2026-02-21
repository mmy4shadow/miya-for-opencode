#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from './install';
import { runNodeHost } from '../nodes/client';
import { currentPolicyHash } from '../policy';
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
  miya gateway <start|serve|terminal|status|doctor|shutdown|autostart>
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
  miya gateway terminal
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
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
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

function normalizeLogCategory(input: string): string {
  const match = /^\[([^\]]+)\]/.exec(input.trim());
  return match ? match[1].toLowerCase() : 'log';
}

function colorByCategory(message: string): string {
  const category = normalizeLogCategory(message);
  if (category.includes('error') || category.includes('failed')) return ANSI.red;
  if (category.includes('warn')) return ANSI.yellow;
  if (category.includes('gateway')) return ANSI.cyan;
  if (category.includes('daemon')) return ANSI.magenta;
  return ANSI.green;
}

function readTailLines(file: string, limit = 80): string[] {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf-8');
  const all = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (all.length <= limit) return all;
  return all.slice(all.length - limit);
}

function formatGatewayConsoleLine(raw: string): string {
  const parsed = /^\[([^\]]+)\]\s(.*)$/.exec(raw);
  if (!parsed) return raw;
  const [, ts, message] = parsed;
  const clock = color(formatClock(ts), ANSI.dim);
  const coloredMessage = color(message, colorByCategory(message));
  return `${clock} ${coloredMessage}`;
}

function resolveGatewayCliEntry(workspace: string): {
  scriptPath: string;
  needsTsx: boolean;
} {
  const sourceCli = path.join(workspace, 'src', 'cli', 'index.ts');
  if (fs.existsSync(sourceCli)) {
    return { scriptPath: sourceCli, needsTsx: true };
  }
  return { scriptPath: resolveCliScriptPath(), needsTsx: false };
}

function startGatewayLogTail(file: string, onLine: (line: string) => void): () => void {
  let cursor = 0;
  let partial = '';
  let timer: NodeJS.Timeout | undefined;

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
    const length = stat.size - cursor;
    if (length <= 0) return;

    const fd = fs.openSync(file, 'r');
    try {
      const chunk = Buffer.alloc(length);
      fs.readSync(fd, chunk, 0, length, cursor);
      cursor = stat.size;
      consume(chunk.toString('utf-8'));
    } finally {
      fs.closeSync(fd);
    }
  };

  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    cursor = stat.size;
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
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function gatewayAutostartScriptPath(): string {
  const startup = windowsStartupDir();
  if (!startup) return '';
  return path.join(startup, 'miya-gateway-terminal.cmd');
}

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function renderGatewayAutostartScript(input: {
  workspace: string;
  nodeBinary: string;
  cliScript: string;
  needsTsx: boolean;
}): string {
  const nodeArgs = [
    input.needsTsx ? '--import tsx' : '',
    quoteForCmd(input.cliScript),
    'gateway terminal',
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
    `${quoteForCmd(input.nodeBinary)} ${nodeArgs}`,
    'endlocal',
    '',
  ].join('\r\n');
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
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as GatewayStartGuard;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.status !== 'idle' && parsed.status !== 'starting' && parsed.status !== 'failed') {
      return null;
    }
    if (!parsed.updatedAt || !Number.isFinite(Date.parse(parsed.updatedAt))) return null;
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
          path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
          path.join(
            process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
            'nodejs',
            'node.exe',
          ),
          path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs', 'node.exe'),
        ]
      : [];
  const candidates = [
    configured || null,
    (() => {
      const execBase = path.basename(process.execPath).toLowerCase();
      return execBase === 'node' || execBase === 'node.exe' ? process.execPath : null;
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
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { url?: string };
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

async function waitGatewayReady(cwd: string, timeoutMs = 15000): Promise<boolean> {
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
  const sourceCliScript = path.join(workspace, 'src', 'cli', 'index.ts');
  const cliScript = fs.existsSync(sourceCliScript) ? sourceCliScript : resolveCliScriptPath();
  const nodeArgs = [
    ...(cliScript.endsWith('.ts') ? ['--import', 'tsx'] : []),
    cliScript,
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
): Promise<unknown> {
  const wsUrl = url.replace(/^http/, 'ws');
  const socket = new WebSocket(`${wsUrl}/ws`);

  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      reject(new Error('gateway_timeout'));
    }, 10000);

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

async function ensureGatewayUrl(cwd: string, autoStart = true): Promise<string> {
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
  const workspace = readFlagValue(args, '--workspace') ?? resolveWorkspaceDir(cwd);
  const { ensureGatewayRunning, stopGateway } = await import('../gateway');

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
}

async function runGatewayTerminal(cwd: string, args: string[]): Promise<number> {
  const workspace = readFlagValue(args, '--workspace') ?? resolveWorkspaceDir(cwd);
  const { ensureGatewayRunning, stopGateway, isGatewayOwner } = await import('../gateway');
  let ownRuntime = false;

  try {
    ensureGatewayRunning(workspace);
    ownRuntime = isGatewayOwner(workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== 'gateway_owned_by_other_process') {
      throw error;
    }
    ownRuntime = false;
  }

  const state = readGatewayState(workspace);
  const logFile = gatewayLogFilePath();

  console.log(
    color(
      `Miya Gateway Terminal - ${ownRuntime ? 'owner' : 'follower'} mode`,
      ANSI.cyan,
    ),
  );
  if (state) {
    console.log(
      `${color('url', ANSI.dim)}=${state.url} ${color('pid', ANSI.dim)}=${state.pid} ${color('log', ANSI.dim)}=${logFile}`,
    );
  } else {
    console.log(`${color('log', ANSI.dim)}=${logFile}`);
  }

  const tailLines = readTailLines(logFile, 80);
  if (tailLines.length > 0) {
    for (const line of tailLines) {
      console.log(formatGatewayConsoleLine(line));
    }
  } else {
    console.log(color('[gateway] waiting for runtime log stream...', ANSI.dim));
  }

  const stopTail = startGatewayLogTail(logFile, (line) => {
    console.log(formatGatewayConsoleLine(line));
  });

  await new Promise<void>((resolve) => {
    const stop = () => {
      stopTail();
      if (ownRuntime) {
        try {
          stopGateway(workspace);
        } catch {}
      }
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

async function runGatewayAutostart(cwd: string, args: string[]): Promise<number> {
  const action = args[0] ?? 'status';
  const workspace = readFlagValue(args, '--workspace') ?? resolveWorkspaceDir(cwd);
  const startupDir = windowsStartupDir();
  if (!startupDir) {
    console.error('gateway_autostart_unsupported_platform');
    return 2;
  }
  const scriptFile = gatewayAutostartScriptPath();
  if (!scriptFile) {
    console.error('gateway_autostart_startup_dir_unavailable');
    return 2;
  }

  if (action === 'status') {
    const exists = fs.existsSync(scriptFile);
    console.log(
      JSON.stringify(
        {
          ok: true,
          action,
          exists,
          startupDir,
          scriptFile,
          workspace,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (action === 'remove' || action === 'uninstall') {
    try {
      fs.unlinkSync(scriptFile);
    } catch {}
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: 'remove',
          removed: true,
          scriptFile,
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
    const entry = resolveGatewayCliEntry(workspace);
    const scriptText = renderGatewayAutostartScript({
      workspace,
      nodeBinary,
      cliScript: entry.scriptPath,
      needsTsx: entry.needsTsx,
    });
    if (!fs.existsSync(path.dirname(scriptFile))) {
      fs.mkdirSync(path.dirname(scriptFile), { recursive: true });
    }
    fs.writeFileSync(scriptFile, scriptText, 'utf-8');
    console.log(
      JSON.stringify(
        {
          ok: true,
          action,
          installed: true,
          scriptFile,
          startupDir,
          workspace,
          nodeBinary,
          cliScript: entry.scriptPath,
          needsTsx: entry.needsTsx,
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
      args.includes('--force') || process.env.MIYA_GATEWAY_CLI_START_ENABLE === '1';
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
  if (action === 'terminal') {
    return await runGatewayTerminal(cwd, args.slice(1));
  }
  if (action === 'autostart') {
    return await runGatewayAutostart(cwd, args.slice(1));
  }

  let url = '';
  try {
    url = await ensureGatewayUrl(cwd, false);
  } catch (error) {
    if (action === 'shutdown') {
      console.log(JSON.stringify({ ok: true, stopped: false, reason: 'not_running' }, null, 2));
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

async function runSubcommand(cwd: string, top: string, args: string[]): Promise<number> {
  const url = await ensureGatewayUrl(cwd);
  const workspace = resolveWorkspaceDir(cwd);
  const withPolicyHash = (params: Record<string, unknown>): Record<string, unknown> => ({
    ...params,
    policyHash: currentPolicyHash(workspace),
  });

  const method = (() => {
    if (top === 'sessions') {
      const action = args[0] ?? 'list';
      if (action === 'list') return ['sessions.list', {}] as const;
      if (action === 'get') return ['sessions.get', { sessionID: args[1] }] as const;
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
      if (action === 'pairs') return ['channels.pair.list', { status: args[1] }] as const;
      if (action === 'approve') return ['channels.pair.approve', { pairID: args[1] }] as const;
      if (action === 'reject') return ['channels.pair.reject', { pairID: args[1] }] as const;
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
      if (action === 'describe') return ['nodes.describe', { nodeID: args[1] }] as const;
      if (action === 'pairs') return ['nodes.pair.list', { status: args[1] }] as const;
      if (action === 'approve') return ['nodes.pair.approve', { pairID: args[1] }] as const;
      if (action === 'reject') return ['nodes.pair.reject', { pairID: args[1] }] as const;
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
      if (action === 'enable') return ['skills.enable', { skillID: args[1] }] as const;
      if (action === 'disable') return ['skills.disable', { skillID: args[1] }] as const;
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
      if (action === 'diff') return ['miya.sync.diff', { sourcePackID: args[1] }] as const;
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
      if (action === 'runs') return ['cron.runs.list', { limit: Number(args[1] ?? 50) }] as const;
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
      if (action === 'run') return ['cron.run.now', { jobID: args[1] }] as const;
      if (action === 'remove') return ['cron.remove', { jobID: args[1] }] as const;
      if (action === 'approvals') return ['cron.approvals.list', {}] as const;
      if (action === 'approve') return ['cron.approvals.approve', { approvalID: args[1] }] as const;
      if (action === 'reject') return ['cron.approvals.reject', { approvalID: args[1] }] as const;
    }

    if (top === 'voice') {
      const action = args[0] ?? 'status';
      if (action === 'status') return ['voice.status', {}] as const;
      if (action === 'wake-on') return ['voice.wake.enable', {}] as const;
      if (action === 'wake-off') return ['voice.wake.disable', {}] as const;
      if (action === 'talk-start') return ['voice.talk.start', { sessionID: args[1] }] as const;
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
      if (action === 'history') return ['voice.history.list', { limit: Number(args[1] ?? 50) }] as const;
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
      if (action === 'close') return ['canvas.close', { docID: args[1] }] as const;
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
      if (action === 'memory-add') return ['companion.memory.add', { fact: args[1] }] as const;
      if (action === 'memory-list') return ['companion.memory.list', {}] as const;
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

async function runNodeHostCommand(cwd: string, args: string[]): Promise<number> {
  const gateway = readFlagValue(args, '--gateway') ?? (await ensureGatewayUrl(cwd));
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
    const installArgs = parseInstallArgs(args.slice(args[0] === 'install' ? 1 : 0));
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
