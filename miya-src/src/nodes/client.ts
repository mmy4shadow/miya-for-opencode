import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaDaemonService } from '../daemon';
import { getMiyaRuntimeDir } from '../workflow';

export interface NodeHostOptions {
  projectDir: string;
  gatewayUrl: string;
  nodeID?: string;
  deviceID?: string;
  nodeType?: 'cli' | 'desktop' | 'mobile' | 'browser';
  nodeToken?: string;
  capabilities?: string[];
  permissions?: {
    screenRecording?: boolean;
    accessibility?: boolean;
    filesystem?: 'none' | 'read' | 'full';
    network?: boolean;
  };
}

interface NodeInvokePayload {
  id: string;
  nodeID: string;
  capability: string;
  args: Record<string, unknown>;
}

interface NodeApprovalRule {
  capability: string;
  pattern?: string;
}

interface NodeApprovalConfig {
  allowAllReadOnly: boolean;
  requireExplicitForRun: boolean;
  allow: NodeApprovalRule[];
  deny: NodeApprovalRule[];
}

const DEFAULT_CAPABILITIES = ['system.info', 'system.which', 'system.run'];

function runtimeDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'node-host');
}

function approvalFile(projectDir: string): string {
  return path.join(runtimeDir(projectDir), 'approval-rules.json');
}

function historyFile(projectDir: string): string {
  return path.join(runtimeDir(projectDir), 'invocation-history.jsonl');
}

function ensureRuntimeDir(projectDir: string): void {
  fs.mkdirSync(runtimeDir(projectDir), { recursive: true });
}

function loadApprovalConfig(projectDir: string): NodeApprovalConfig {
  ensureRuntimeDir(projectDir);
  const file = approvalFile(projectDir);
  if (!fs.existsSync(file)) {
    const defaults: NodeApprovalConfig = {
      allowAllReadOnly: true,
      requireExplicitForRun: true,
      allow: [
        { capability: 'system.run', pattern: '^echo\\b' },
        { capability: 'system.run', pattern: '^pwd\\b' },
        { capability: 'system.run', pattern: '^dir\\b' },
        { capability: 'system.run', pattern: '^ls\\b' },
      ],
      deny: [
        { capability: 'system.run', pattern: '(?i)\\brm\\s+-rf\\b' },
        { capability: 'system.run', pattern: '(?i)\\bdel\\b' },
        { capability: 'system.run', pattern: '(?i)\\bformat\\b' },
      ],
    };
    fs.writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`, 'utf-8');
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<NodeApprovalConfig>;
    return {
      allowAllReadOnly: parsed.allowAllReadOnly ?? true,
      requireExplicitForRun: parsed.requireExplicitForRun ?? true,
      allow: Array.isArray(parsed.allow) ? parsed.allow : [],
      deny: Array.isArray(parsed.deny) ? parsed.deny : [],
    };
  } catch {
    return {
      allowAllReadOnly: true,
      requireExplicitForRun: true,
      allow: [],
      deny: [],
    };
  }
}

function evaluateRule(
  rule: NodeApprovalRule,
  capability: string,
  payload: string,
): boolean {
  if (rule.capability !== capability) return false;
  if (!rule.pattern) return true;
  try {
    return new RegExp(rule.pattern).test(payload);
  } catch {
    return false;
  }
}

function isAllowedByLocalPolicy(
  config: NodeApprovalConfig,
  capability: string,
  args: Record<string, unknown>,
): { ok: boolean; reason?: string } {
  const payload = JSON.stringify(args ?? {});

  if (config.deny.some((rule) => evaluateRule(rule, capability, payload))) {
    return { ok: false, reason: 'blocked_by_local_deny_rule' };
  }

  if (
    config.allowAllReadOnly &&
    (capability === 'system.info' || capability === 'system.which')
  ) {
    return { ok: true };
  }

  if (capability === 'system.run' && config.requireExplicitForRun) {
    const allowed = config.allow.some((rule) => evaluateRule(rule, capability, payload));
    return allowed
      ? { ok: true }
      : { ok: false, reason: 'system.run_requires_allow_rule' };
  }

  if (config.allow.some((rule) => evaluateRule(rule, capability, payload))) {
    return { ok: true };
  }

  return { ok: false, reason: 'no_matching_allow_rule' };
}

function appendHistory(
  projectDir: string,
  row: Record<string, unknown>,
): void {
  ensureRuntimeDir(projectDir);
  fs.appendFileSync(historyFile(projectDir), `${JSON.stringify(row)}\n`, 'utf-8');
}

function runShellCommand(
  command: string,
  timeoutMs: number,
): {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const cmd =
    process.platform === 'win32'
      ? ['powershell', '-NoProfile', '-Command', command]
      : ['sh', '-lc', command];
  const proc = Bun.spawnSync(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: Math.max(1000, Math.min(timeoutMs, 10 * 60 * 1000)),
  });

  return {
    ok: proc.exitCode === 0,
    exitCode: proc.exitCode,
    stdout: Buffer.from(proc.stdout).toString('utf-8'),
    stderr: Buffer.from(proc.stderr).toString('utf-8'),
  };
}

async function executeCapability(
  projectDir: string,
  payload: NodeInvokePayload,
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  if (payload.capability === 'system.info') {
    return {
      ok: true,
      result: {
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        cpus: os.cpus().length,
        memory: os.totalmem(),
      },
    };
  }

  if (payload.capability === 'system.which') {
    const binary = typeof payload.args.binary === 'string' ? payload.args.binary : '';
    if (!binary) return { ok: false, error: 'missing_binary' };
    const cmd = process.platform === 'win32' ? `where ${binary}` : `which ${binary}`;
    const result = runShellCommand(cmd, 10000);
    return {
      ok: result.ok,
      result: result.ok
        ? { binary, path: result.stdout.trim() }
        : undefined,
      error: result.ok ? undefined : result.stderr.trim() || 'binary_not_found',
    };
  }

  if (payload.capability === 'system.run') {
    const command = typeof payload.args.command === 'string' ? payload.args.command : '';
    const timeoutMs =
      typeof payload.args.timeoutMs === 'number'
        ? Number(payload.args.timeoutMs)
        : 120000;
    if (!command) return { ok: false, error: 'missing_command' };
    const daemon = getMiyaDaemonService(projectDir);
    const result = await daemon.runIsolatedProcess({
      kind: 'shell.exec',
      command: process.platform === 'win32' ? 'powershell' : 'sh',
      args:
        process.platform === 'win32'
          ? ['-NoProfile', '-Command', command]
          : ['-lc', command],
      timeoutMs,
      resource: {
        priority: 70,
        vramMB: 0,
      },
      metadata: {
        capability: payload.capability,
      },
    });
    return {
      ok: result.exitCode === 0 && !result.timedOut,
      result: {
        exitCode: result.exitCode,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
      error:
        result.exitCode === 0 && !result.timedOut
          ? undefined
          : result.timedOut
            ? 'timeout'
            : `exit_${result.exitCode}`,
    };
  }

  if (payload.capability === 'canvas.render') {
    const content = typeof payload.args.content === 'string' ? payload.args.content : '';
    if (!content) return { ok: false, error: 'missing_canvas_content' };
    const canvasDir = path.join(runtimeDir(projectDir), 'canvas');
    fs.mkdirSync(canvasDir, { recursive: true });
    const file = path.join(canvasDir, `canvas-${Date.now()}.txt`);
    fs.writeFileSync(file, content, 'utf-8');
    return {
      ok: true,
      result: {
        saved: true,
        path: file,
      },
    };
  }

  return { ok: false, error: `unsupported_capability:${payload.capability}` };
}

async function sendFrame(
  socket: WebSocket,
  frame: Record<string, unknown>,
): Promise<void> {
  socket.send(JSON.stringify(frame));
}

export async function runNodeHost(options: NodeHostOptions): Promise<void> {
  const projectDir = options.projectDir;
  const nodeID =
    options.nodeID || process.env.MIYA_NODE_ID || `node-${os.hostname()}-${randomUUID().slice(0, 8)}`;
  const deviceID =
    options.deviceID ||
    process.env.MIYA_DEVICE_ID ||
    `${os.hostname()}-${process.platform}-${process.arch}`;
  const capabilities = [...new Set(options.capabilities ?? DEFAULT_CAPABILITIES)];
  const nodeType = options.nodeType ?? 'cli';
  const wsUrl = `${options.gatewayUrl.replace(/^http/, 'ws')}/ws`;
  const gatewayToken = process.env.MIYA_GATEWAY_TOKEN;
  const nodeToken = options.nodeToken || process.env.MIYA_NODE_TOKEN;
  let stopRequested = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const connect = async (): Promise<void> => {
    if (stopRequested) return;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      void sendFrame(socket as WebSocket, {
        type: 'hello',
        role: 'node',
        protocolVersion: '1.0',
        clientID: nodeID,
        auth: gatewayToken ? { token: gatewayToken } : undefined,
        capabilities,
      });
      void sendFrame(socket as WebSocket, {
        type: 'request',
        id: `register-${Date.now()}`,
        method: 'nodes.register',
        params: {
          nodeID,
          deviceID,
          type: nodeType,
          token: nodeToken,
          platform: process.platform,
          capabilities,
          permissions: options.permissions,
        },
      });
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        void sendFrame(socket, {
          type: 'request',
          id: `hb-${Date.now()}`,
          method: 'nodes.heartbeat',
          params: {
            nodeID,
          },
        });
      }, 30_000);
      void sendFrame(socket as WebSocket, {
        type: 'request',
        id: `sub-${Date.now()}`,
        method: 'gateway.subscribe',
        params: { events: ['*'] },
      });
    };

    socket.onmessage = (event) => {
      void (async () => {
        const text = String(event.data ?? '');
        if (!text.trim()) return;
        const frame = JSON.parse(text) as {
          type?: string;
          event?: string;
          payload?: unknown;
        };
        if (frame.type !== 'event' || frame.event !== 'node.invoke.request') return;
        const payload = frame.payload as NodeInvokePayload;
        if (!payload || payload.nodeID !== nodeID) return;

        const policy = loadApprovalConfig(projectDir);
        const allowed = isAllowedByLocalPolicy(policy, payload.capability, payload.args);
        let response: { ok: boolean; result?: Record<string, unknown>; error?: string };
        if (!allowed.ok) {
          response = { ok: false, error: allowed.reason ?? 'blocked_by_local_policy' };
        } else {
          response = await executeCapability(projectDir, payload);
        }

        appendHistory(projectDir, {
          at: new Date().toISOString(),
          nodeID,
          invokeID: payload.id,
          capability: payload.capability,
          args: payload.args,
          ok: response.ok,
          error: response.error,
        });

        await sendFrame(socket as WebSocket, {
          type: 'request',
          id: `invoke-result-${payload.id}`,
          method: 'nodes.invoke.result',
          params: {
            invokeID: payload.id,
            ok: response.ok,
            result: response.result,
            error: response.error,
          },
        });
      })();
    };

    socket.onclose = () => {
      if (stopRequested) return;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      reconnectTimer = setTimeout(() => {
        void connect();
      }, 3000);
    };

    socket.onerror = () => {
      try {
        socket?.close();
      } catch {}
    };
  };

  await connect();

  const shutdown = (): void => {
    stopRequested = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      socket?.close();
    } catch {}
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (stopRequested) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
  });
}
