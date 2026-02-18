#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

type SupervisorStatus =
  | 'starting'
  | 'running'
  | 'backoff'
  | 'stopping'
  | 'stopped'
  | 'failed';

interface SupervisorState {
  pid: number;
  status: SupervisorStatus;
  workspace: string;
  startedAt: string;
  updatedAt: string;
  childPid?: number;
  restartCount: number;
  lastError?: string;
}

interface GatewayRuntimeState {
  url: string;
  pid: number;
}

const START_ATTEMPTS = [
  (workspace: string) => [
    'run',
    '--model',
    'openrouter/moonshotai/kimi-k2.5',
    '--command',
    'miya-gateway-start',
    '--dir',
    workspace,
  ],
  (workspace: string) => [
    'run',
    '--model',
    'opencode/big-pickle',
    '--command',
    'miya-gateway-start',
    '--dir',
    workspace,
  ],
  (workspace: string) => ['run', '--command', 'miya-gateway-start', '--dir', workspace],
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function getMiyaRuntimeDir(projectDir: string): string {
  const normalized = path.resolve(projectDir);
  if (path.basename(normalized).toLowerCase() === '.opencode') {
    return path.join(normalized, 'miya');
  }
  return path.join(normalized, '.opencode', 'miya');
}

function runtimeGatewayFile(workspace: string): string {
  return path.join(getMiyaRuntimeDir(workspace), 'gateway.json');
}

function runtimeSupervisorFile(workspace: string): string {
  return path.join(getMiyaRuntimeDir(workspace), 'gateway-supervisor.json');
}

function runtimeSupervisorStopFile(workspace: string): string {
  return path.join(getMiyaRuntimeDir(workspace), 'gateway-supervisor.stop');
}

function runtimeSupervisorLogFile(workspace: string): string {
  return path.join(getMiyaRuntimeDir(workspace), 'gateway-supervisor.log');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function readGatewayState(workspace: string): GatewayRuntimeState | null {
  const file = runtimeGatewayFile(workspace);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      url?: unknown;
      pid?: unknown;
    };
    const url = String(parsed.url ?? '').trim();
    const pid = Number(parsed.pid);
    if (!url || !Number.isFinite(pid) || pid <= 0) return null;
    return { url, pid: Math.floor(pid) };
  } catch {
    return null;
  }
}

async function probeGateway(url: string, timeoutMs = 1_200): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/status`, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function isGatewayHealthy(workspace: string): Promise<boolean> {
  const state = readGatewayState(workspace);
  if (!state || !isPidAlive(state.pid)) return false;
  return await probeGateway(state.url);
}

function appendLog(workspace: string, message: string): void {
  const runtimeDir = getMiyaRuntimeDir(workspace);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const line = `[${nowIso()}] ${message}\n`;
  fs.appendFileSync(runtimeSupervisorLogFile(workspace), line, 'utf-8');
}

function writeSupervisorState(
  workspace: string,
  patch: Partial<SupervisorState> & Pick<SupervisorState, 'status'>,
  baseline: Omit<SupervisorState, 'status' | 'updatedAt'>,
): void {
  const runtimeDir = getMiyaRuntimeDir(workspace);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const state: SupervisorState = {
    ...baseline,
    status: patch.status,
    updatedAt: nowIso(),
    workspace,
    childPid: patch.childPid,
    restartCount: patch.restartCount ?? baseline.restartCount,
    lastError: patch.lastError,
  };
  fs.writeFileSync(
    runtimeSupervisorFile(workspace),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf-8',
  );
}

function parseCliArgs(argv: string[]): { workspace: string; verbose: boolean } {
  let workspace = '';
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i] ?? '';
    if (current === '--workspace' && i + 1 < argv.length) {
      workspace = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (current.startsWith('--workspace=')) {
      workspace = current.slice('--workspace='.length);
    }
  }
  return {
    workspace: path.resolve(workspace || process.cwd()),
    verbose: argv.includes('--verbose'),
  };
}

function killPid(pid: number): void {
  if (!isPidAlive(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
    return;
  } catch {}
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    } catch {}
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
}

function terminateChild(child: ChildProcess | null): void {
  if (!child || !child.pid || child.exitCode !== null) return;
  killPid(child.pid);
}

async function waitReadyOrExit(
  workspace: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ ready: boolean; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(runtimeSupervisorStopFile(workspace))) {
      return { ready: false, reason: 'stop_signal' };
    }
    if (await isGatewayHealthy(workspace)) {
      return { ready: true, reason: 'ready' };
    }
    if (child.exitCode !== null) {
      return { ready: false, reason: `opencode_exit_${child.exitCode}` };
    }
    await sleep(400);
  }
  return { ready: false, reason: 'gateway_probe_timeout' };
}

async function main(): Promise<void> {
  const { workspace, verbose } = parseCliArgs(process.argv.slice(2));
  const runtimeDir = getMiyaRuntimeDir(workspace);
  const stopFile = runtimeSupervisorStopFile(workspace);
  fs.mkdirSync(runtimeDir, { recursive: true });
  try {
    fs.unlinkSync(stopFile);
  } catch {}

  const baseline: Omit<SupervisorState, 'status' | 'updatedAt'> = {
    pid: process.pid,
    workspace,
    startedAt: nowIso(),
    childPid: undefined,
    restartCount: 0,
    lastError: undefined,
  };

  let child: ChildProcess | null = null;
  let stopping = false;
  let attemptIndex = 0;
  let restartCount = 0;

  const stopRequested = (): boolean =>
    stopping || fs.existsSync(runtimeSupervisorStopFile(workspace));

  const onStopSignal = (signal: NodeJS.Signals): void => {
    stopping = true;
    appendLog(workspace, `received ${signal}, stopping supervisor`);
  };

  process.on('SIGTERM', onStopSignal);
  process.on('SIGINT', onStopSignal);
  process.on('SIGHUP', onStopSignal);

  appendLog(workspace, `supervisor_started pid=${process.pid} workspace=${workspace}`);
  writeSupervisorState(workspace, { status: 'starting' }, baseline);

  while (!stopRequested()) {
    if (await isGatewayHealthy(workspace)) {
      writeSupervisorState(
        workspace,
        {
          status: 'running',
          childPid: child?.pid,
          restartCount,
          lastError: undefined,
        },
        baseline,
      );
      await sleep(1_500);
      continue;
    }

    const argsFactory = START_ATTEMPTS[attemptIndex % START_ATTEMPTS.length];
    attemptIndex += 1;
    const opencodeArgs = argsFactory(workspace);
    writeSupervisorState(
      workspace,
      {
        status: 'starting',
        childPid: undefined,
        restartCount,
      },
      baseline,
    );
    appendLog(
      workspace,
      `starting_opencode attempt=${attemptIndex} cmd=opencode ${opencodeArgs.join(' ')}`,
    );
    child = spawn('opencode', opencodeArgs, {
      cwd: workspace,
      stdio: verbose ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      windowsHide: true,
    });

    if (verbose && child.stdout) {
      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = String(chunk);
        process.stdout.write(text);
        appendLog(workspace, `opencode.stdout ${text.trim()}`);
      });
    }
    if (verbose && child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = String(chunk);
        process.stderr.write(text);
        appendLog(workspace, `opencode.stderr ${text.trim()}`);
      });
    }

    const waited = await waitReadyOrExit(workspace, child, 30_000);
    if (waited.ready) {
      restartCount = 0;
      writeSupervisorState(
        workspace,
        {
          status: 'running',
          childPid: child.pid,
          restartCount,
          lastError: undefined,
        },
        baseline,
      );
      appendLog(
        workspace,
        `gateway_ready pid=${String(child.pid ?? '')} attempt=${attemptIndex}`,
      );
      continue;
    }

    const reason = waited.reason;
    terminateChild(child);
    child = null;
    restartCount += 1;
    const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(restartCount, 5));
    appendLog(
      workspace,
      `gateway_start_failed reason=${reason} restartCount=${restartCount} backoffMs=${backoffMs}`,
    );
    writeSupervisorState(
      workspace,
      {
        status: 'backoff',
        restartCount,
        lastError: reason,
      },
      baseline,
    );
    await sleep(backoffMs);
  }

  writeSupervisorState(
    workspace,
    {
      status: 'stopping',
      childPid: child?.pid,
      restartCount,
    },
    baseline,
  );
  terminateChild(child);
  child = null;
  writeSupervisorState(
    workspace,
    {
      status: 'stopped',
      restartCount,
    },
    baseline,
  );
  appendLog(workspace, 'supervisor_stopped');
}

main().catch((error) => {
  const { workspace } = parseCliArgs(process.argv.slice(2));
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  appendLog(workspace, `supervisor_failed error=${message}`);
  try {
    const file = runtimeSupervisorFile(workspace);
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        {
          pid: process.pid,
          status: 'failed',
          workspace,
          startedAt: nowIso(),
          updatedAt: nowIso(),
          restartCount: 0,
          lastError: message,
        } satisfies SupervisorState,
        null,
        2,
      )}\n`,
      'utf-8',
    );
  } catch {}
  process.exit(1);
});
