#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { install } from './install';
import { runNodeHost } from '../nodes/client';
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
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
miya cli

Usage:
  bunx miya install [OPTIONS]
  bunx miya gateway <start|status|doctor|shutdown>
  bunx miya sessions <list|get|send|policy>
  bunx miya channels <list|status|pairs|approve|reject|send>
  bunx miya nodes <list|status|describe|pairs|approve|reject|invoke>
  bunx miya skills <status|enable|disable|install|update>
  bunx miya cron <list|runs|add|run|remove|approvals|approve|reject>
  bunx miya voice <status|wake-on|wake-off|talk-start|talk-stop|ingest|history|clear>
  bunx miya canvas <status|list|get|open|render|close>
  bunx miya companion <status|wizard|profile|memory-add|memory-list|asset-add|asset-list|reset>

Examples:
  bunx miya gateway status
  bunx miya sessions send webchat:main "hello"
  bunx miya channels send telegram 123456 "hi"
  bunx miya nodes invoke node-1 system.run '{"command":"pwd"}'
  bunx miya node-host --gateway http://127.0.0.1:17321
`);
}

function runtimeGatewayFile(cwd: string): string {
  return path.join(cwd, '.opencode', 'miya', 'gateway.json');
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

function runGatewayStart(cwd: string): boolean {
  const proc = spawnSync('opencode', ['run', '--command', 'miya-gateway-start'], {
    cwd,
    stdio: 'inherit',
  });
  return proc.status === 0;
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
  let url = readGatewayUrl(cwd);
  if (url) {
    try {
      await callGatewayMethod(url, 'gateway.status.get', {});
      return url;
    } catch {
      clearGatewayStateFile(cwd);
      url = null;
    }
  }

  if (autoStart && runGatewayStart(cwd)) {
    url = readGatewayUrl(cwd);
    if (url) {
      try {
        await callGatewayMethod(url, 'gateway.status.get', {});
        return url;
      } catch {
        clearGatewayStateFile(cwd);
      }
    }
  }

  throw new Error('gateway_unavailable');
}

async function runGatewayCommand(cwd: string, args: string[]): Promise<number> {
  const action = args[0] ?? 'status';

  if (action === 'start') {
    const ok = runGatewayStart(cwd);
    return ok ? 0 : 1;
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
          {
            repo: args[1],
            targetName: args[2],
            sessionID: args[3] ?? 'main',
          },
        ] as const;
      if (action === 'update')
        return [
          'skills.update',
          {
            dir: args[1],
            sessionID: args[2] ?? 'main',
          },
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
  const index = args.findIndex((item) => item === key);
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
