#!/usr/bin/env bun
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeHost } from '../nodes/client';
import { currentPolicyHash } from '../policy';
import { getMiyaRuntimeDir } from '../workflow';
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
  bunx miya install [OPTIONS]
  bunx miya gateway <start|serve|status|doctor|shutdown>
  bunx miya sessions <list|get|send|policy>
  bunx miya channels <list|status|pairs|approve|reject|send>
  bunx miya nodes <list|status|describe|pairs|approve|reject|invoke>
  bunx miya skills <status|enable|disable|install|update>
  bunx miya sync <list|pull|diff|apply|rollback>
  bunx miya cron <list|runs|add|run|remove|approvals|approve|reject>
  bunx miya voice <status|wake-on|wake-off|talk-start|talk-stop|ingest|history|clear>
  bunx miya canvas <status|list|get|open|render|close>
  bunx miya companion <status|wizard|profile|memory-add|memory-list|asset-add|asset-list|reset>

Examples:
  bunx miya gateway status
  bunx miya sessions send webchat:main "hello"
  bunx miya channels send telegram 123456 "hi"
  bunx miya nodes invoke node-1 system.run '{"command":"pwd"}'
  bunx miya sync list
  bunx miya node-host --gateway http://127.0.0.1:17321
  bunx miya install --no-tui --kimi=yes --openai=no --anthropic=no --copilot=no --zai-plan=no --antigravity=no --chutes=no --tmux=no --skills=yes --isolated=yes
`);
}

function runtimeGatewayFile(cwd: string): string {
  return path.join(getMiyaRuntimeDir(cwd), 'gateway.json');
}

interface GatewaySupervisorState {
  pid: number;
  status: string;
  updatedAt: string;
  childPid?: number;
  lastError?: string;
}

interface GatewayStartOptions {
  verbose?: boolean;
  restartSupervisor?: boolean;
}

interface GatewayStartGuard {
  status: 'idle' | 'starting' | 'failed';
  updatedAt: string;
  cooldownUntil?: string;
}

function runtimeGatewayStartGuardFile(cwd: string): string {
  return path.join(getMiyaRuntimeDir(cwd), 'gateway-start.guard.json');
}

function runtimeGatewaySupervisorFile(cwd: string): string {
  return path.join(getMiyaRuntimeDir(cwd), 'gateway-supervisor.json');
}

function runtimeGatewaySupervisorStopFile(cwd: string): string {
  return path.join(getMiyaRuntimeDir(cwd), 'gateway-supervisor.stop');
}

function readGatewaySupervisorState(cwd: string): GatewaySupervisorState | null {
  const file = runtimeGatewaySupervisorFile(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      pid?: unknown;
      status?: unknown;
      updatedAt?: unknown;
      childPid?: unknown;
      lastError?: unknown;
    };
    const pid = Number(parsed.pid);
    const status = String(parsed.status ?? '').trim();
    const updatedAt = String(parsed.updatedAt ?? '').trim();
    const childPid =
      parsed.childPid === undefined ? undefined : Number(parsed.childPid);
    const lastError =
      typeof parsed.lastError === 'string'
        ? parsed.lastError.trim() || undefined
        : undefined;
    if (!Number.isFinite(pid) || pid <= 0 || !status || !updatedAt) {
      return null;
    }
    return {
      pid: Math.floor(pid),
      status,
      updatedAt,
      childPid:
        childPid !== undefined && Number.isFinite(childPid) && childPid > 0
          ? Math.floor(childPid)
          : undefined,
      lastError,
    };
  } catch {
    return null;
  }
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
  const resolved = path.resolve(cwd);
  if (path.basename(resolved).toLowerCase() === '.opencode') {
    return resolved;
  }
  if (path.basename(resolved).toLowerCase() === 'miya-src') {
    const parent = path.dirname(resolved);
    if (path.basename(parent).toLowerCase() === '.opencode') {
      return parent;
    }
  }
  const embeddedOpencode = path.join(resolved, '.opencode');
  if (
    fs.existsSync(path.join(embeddedOpencode, 'miya-src', 'src', 'index.ts'))
  ) {
    return embeddedOpencode;
  }
  return resolved;
}

function clearGatewayStateFile(cwd: string): void {
  try {
    fs.unlinkSync(runtimeGatewayFile(cwd));
  } catch {}
}

function clearGatewaySupervisorStateFile(cwd: string): void {
  try {
    fs.unlinkSync(runtimeGatewaySupervisorFile(cwd));
  } catch {}
}

function clearGatewaySupervisorStopSignal(cwd: string): void {
  try {
    fs.unlinkSync(runtimeGatewaySupervisorStopFile(cwd));
  } catch {}
}

interface GatewayEndpoint {
  url: string;
  authToken?: string;
}

function readGatewayEndpoint(cwd: string): GatewayEndpoint | null {
  const file = runtimeGatewayFile(cwd);
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      url?: string;
      authToken?: unknown;
    };
    const url = String(parsed.url ?? '').trim();
    if (!url) return null;
    const authToken =
      typeof parsed.authToken === 'string' && parsed.authToken.trim().length > 0
        ? parsed.authToken.trim()
        : undefined;
    return { url, authToken };
  } catch {
    return null;
  }
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

function resolveNodeBin(): string {
  const rawNodeBin = String(process.env.MIYA_GATEWAY_NODE_BIN ?? 'node').trim();
  const nodeBin = rawNodeBin.replace(/^["']+|["']+$/g, '') || 'node';
  const probe = spawnSync(nodeBin, ['--version'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `node_runtime_unavailable:${nodeBin} (raw=${rawNodeBin}; set MIYA_GATEWAY_NODE_BIN or install Node.js)`,
    );
  }
  return nodeBin;
}

function resolveGatewaySupervisorScriptPath(): string {
  const script = fileURLToPath(
    new URL('./gateway-supervisor.node.js', import.meta.url),
  );
  if (!fs.existsSync(script)) {
    throw new Error(
      `gateway_supervisor_script_missing:${script} (run \`bun run build\` in miya-src)`,
    );
  }
  return script;
}

async function stopGatewaySupervisor(cwd: string): Promise<boolean> {
  const state = readGatewaySupervisorState(cwd);
  if (!state) return false;
  const runtimeDir = getMiyaRuntimeDir(cwd);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    runtimeGatewaySupervisorStopFile(cwd),
    `${new Date().toISOString()}\n`,
    'utf-8',
  );
  killPid(state.pid);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isPidAlive(state.pid)) {
      clearGatewaySupervisorStateFile(cwd);
      clearGatewaySupervisorStopSignal(cwd);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return !isPidAlive(state.pid);
}

function startGatewaySupervisor(
  cwd: string,
  options: { detached: boolean; verbose?: boolean },
): { pid: number } {
  const workspace = resolveWorkspaceDir(cwd);
  const nodeBin = resolveNodeBin();
  const script = resolveGatewaySupervisorScriptPath();
  clearGatewaySupervisorStopSignal(workspace);

  const args = [script, '--workspace', workspace];
  if (options.verbose) args.push('--verbose');

  const child = spawn(nodeBin, args, {
    cwd: workspace,
    detached: options.detached,
    stdio: options.detached ? 'ignore' : 'inherit',
    windowsHide: options.detached,
  });

  if (options.detached) {
    child.unref();
  }

  return { pid: child.pid ?? 0 };
}

function readGatewayState(
  cwd: string,
): { url: string; pid: number; authToken?: string } | null {
  const file = runtimeGatewayFile(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      url?: unknown;
      pid?: unknown;
      authToken?: unknown;
    };
    const url = String(parsed.url ?? '').trim();
    const pid = Number(parsed.pid);
    const authToken =
      typeof parsed.authToken === 'string' && parsed.authToken.trim().length > 0
        ? parsed.authToken.trim()
        : undefined;
    if (!url || !Number.isFinite(pid)) return null;
    return { url, pid, authToken };
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
        await callGatewayMethod(
          state.url,
          'gateway.status.get',
          {},
          state.authToken,
        );
        return true;
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function runGatewayStart(
  cwd: string,
  options: GatewayStartOptions = {},
): Promise<boolean> {
  const workspace = resolveWorkspaceDir(cwd);
  const guard = readGatewayStartGuard(workspace);
  const now = Date.now();
  if (guard?.status === 'starting') {
    const ageMs = now - Date.parse(guard.updatedAt);
    if (ageMs < 30_000) {
      return true;
    }
  }
  if (guard?.cooldownUntil && now < Date.parse(guard.cooldownUntil)) {
    return true;
  }
  writeGatewayStartGuard(workspace, {
    status: 'starting',
    updatedAt: new Date(now).toISOString(),
  });

  const supervisor = readGatewaySupervisorState(workspace);
  const supervisorAlive = supervisor ? isPidAlive(supervisor.pid) : false;
  if (options.restartSupervisor && supervisorAlive) {
    await stopGatewaySupervisor(workspace);
  }
  if (!supervisorAlive || options.restartSupervisor) {
    startGatewaySupervisor(workspace, {
      detached: true,
      verbose: options.verbose,
    });
  }

  if (await waitGatewayReady(workspace, 25000)) {
    writeGatewayStartGuard(workspace, {
      status: 'idle',
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
  clearGatewayStateFile(workspace);
  writeGatewayStartGuard(workspace, {
    status: 'failed',
    updatedAt: new Date().toISOString(),
    cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
  });
  return false;
}

async function callGatewayMethod(
  url: string,
  method: string,
  params: Record<string, unknown>,
  authToken?: string,
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
      const token = authToken ?? process.env.MIYA_GATEWAY_TOKEN;
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

async function ensureGatewayEndpoint(
  cwd: string,
  autoStart = true,
): Promise<GatewayEndpoint> {
  const workspace = resolveWorkspaceDir(cwd);
  let endpoint = readGatewayEndpoint(workspace);
  if (endpoint) {
    try {
      await callGatewayMethod(
        endpoint.url,
        'gateway.status.get',
        {},
        endpoint.authToken,
      );
      return endpoint;
    } catch {
      clearGatewayStateFile(workspace);
      endpoint = null;
    }
  }

  if (autoStart && (await runGatewayStart(workspace))) {
    endpoint = readGatewayEndpoint(workspace);
    if (endpoint) {
      try {
        await callGatewayMethod(
          endpoint.url,
          'gateway.status.get',
          {},
          endpoint.authToken,
        );
        return endpoint;
      } catch {
        clearGatewayStateFile(workspace);
      }
    }
  }

  throw new Error('gateway_unavailable');
}

async function runGatewayServe(cwd: string, args: string[]): Promise<number> {
  const workspace = resolveWorkspaceDir(cwd);
  const restartSupervisor = args.includes('--restart');
  const verbose = args.includes('--verbose');
  if (restartSupervisor) {
    await stopGatewaySupervisor(workspace);
  }
  const nodeBin = resolveNodeBin();
  const script = resolveGatewaySupervisorScriptPath();
  clearGatewaySupervisorStopSignal(workspace);
  const child = spawn(
    nodeBin,
    [script, '--workspace', workspace, ...(verbose ? ['--verbose'] : [])],
    {
      cwd: workspace,
      stdio: 'inherit',
      windowsHide: false,
    },
  );
  return await new Promise<number>((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function runGatewayCommand(cwd: string, args: string[]): Promise<number> {
  const action = args[0] ?? 'status';
  const workspace = resolveWorkspaceDir(cwd);

  if (action === 'start' || action === 'serve') {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const allowCliStart =
      args.includes('--force') ||
      process.env.MIYA_GATEWAY_CLI_START_ENABLE === '1' ||
      !interactive;
    if (!allowCliStart) {
      console.error(
        'gateway_start_blocked:safety_guard (use `miya gateway start --force` or set MIYA_GATEWAY_CLI_START_ENABLE=1)',
      );
      return 2;
    }
    if (action === 'serve') {
      return await runGatewayServe(cwd, args.slice(1));
    }
    const ok = await runGatewayStart(cwd, {
      verbose: args.includes('--verbose'),
      restartSupervisor: args.includes('--restart'),
    });
    return ok ? 0 : 1;
  }

  let endpoint: GatewayEndpoint | null = null;
  try {
    endpoint = await ensureGatewayEndpoint(cwd, false);
  } catch (error) {
    if (action === 'shutdown') {
      const supervisorStopped = await stopGatewaySupervisor(workspace);
      console.log(
        JSON.stringify(
          {
            ok: true,
            stopped: false,
            reason: 'not_running',
            supervisorStopped,
          },
          null,
          2,
        ),
      );
      return 0;
    }
    throw error;
  }
  if (!endpoint) {
    throw new Error('gateway_unavailable');
  }
  if (action === 'status') {
    const result = await callGatewayMethod(
      endpoint.url,
      'gateway.status.get',
      {},
      endpoint.authToken,
    );
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === 'doctor') {
    const result = await callGatewayMethod(
      endpoint.url,
      'doctor.run',
      {},
      endpoint.authToken,
    );
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === 'shutdown') {
    const supervisorStopped = await stopGatewaySupervisor(workspace);
    try {
      const result = (await callGatewayMethod(
        endpoint.url,
        'gateway.shutdown',
        {},
        endpoint.authToken,
      )) as Record<string, unknown>;
      console.log(
        JSON.stringify(
          {
            ...result,
            supervisorStopped,
          },
          null,
          2,
        ),
      );
      return 0;
    } catch (error) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            stopped: false,
            reason:
              error instanceof Error ? error.message : String(error ?? ''),
            supervisorStopped,
          },
          null,
          2,
        ),
      );
      return 1;
    }
  }

  throw new Error(`unknown_gateway_action:${action}`);
}

async function runSubcommand(
  cwd: string,
  top: string,
  args: string[],
): Promise<number> {
  const endpoint = await ensureGatewayEndpoint(cwd);
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
  const result = await callGatewayMethod(
    endpoint.url,
    methodName,
    params,
    endpoint.authToken,
  );
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
    readFlagValue(args, '--gateway') ?? (await ensureGatewayEndpoint(cwd)).url;
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
