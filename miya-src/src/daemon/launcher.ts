import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getMiyaRuntimeDir } from '../workflow';
import {
  parseDaemonOutgoingFrame,
  DaemonHelloFrameSchema,
  DaemonPingFrameSchema,
  DaemonRequestFrameSchema,
  DaemonResponseFrameSchema,
} from './ws-protocol';

interface DaemonLockState {
  pid: number;
  wsPort: number;
  token: string;
  updatedAt: string;
}

export interface DaemonConnectionSnapshot {
  connected: boolean;
  statusText: string;
  port?: number;
  pid?: number;
  uptimeSec?: number;
  cpuPercent?: number;
  vramUsedMB?: number;
  vramTotalMB?: number;
  lastSeenAt?: string;
  startedAt: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface LauncherRuntime {
  projectDir: string;
  daemonToken: string;
  parentLockFile: string;
  daemonLockFile: string;
  parentBeatTimer?: ReturnType<typeof setInterval>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  pingTimer?: ReturnType<typeof setInterval>;
  statusTimer?: ReturnType<typeof setInterval>;
  pingWatchdog?: ReturnType<typeof setTimeout>;
  ws?: WebSocket;
  reconnectBackoffMs: number;
  connected: boolean;
  lastPongAt?: number;
  reqSeq: number;
  pending: Map<string, PendingRequest>;
  maxPendingRequests: number;
  snapshot: DaemonConnectionSnapshot;
}

const runtimes = new Map<string, LauncherRuntime>();

function nowIso(): string {
  return new Date().toISOString();
}

function daemonDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'daemon');
}

function ensureDaemonDir(projectDir: string): void {
  fs.mkdirSync(daemonDir(projectDir), { recursive: true });
}

function safeWriteJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function safeReadJson(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toDaemonLock(raw: Record<string, unknown> | null): DaemonLockState | null {
  if (!raw) return null;
  const pid = Number(raw.pid);
  const wsPort = Number(raw.wsPort);
  const token = String(raw.token ?? '');
  const updatedAt = String(raw.updatedAt ?? '');
  if (!Number.isFinite(pid) || !Number.isFinite(wsPort) || !token || !updatedAt) return null;
  return { pid, wsPort, token, updatedAt };
}

function resolveHostScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tsFile = path.join(here, 'host.ts');
  const jsFile = path.join(here, 'host.js');
  if (fs.existsSync(tsFile)) return tsFile;
  return jsFile;
}

function spawnDaemon(runtime: LauncherRuntime): void {
  const bunBinary = Bun.which('bun') ?? process.execPath;
  const hostScript = resolveHostScriptPath();
  spawn(
    bunBinary,
    [
      hostScript,
      '--project-dir',
      runtime.projectDir,
      '--parent-lock-file',
      runtime.parentLockFile,
      '--token',
      runtime.daemonToken,
    ],
    {
      cwd: runtime.projectDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  ).unref();
}

function writeParentLock(runtime: LauncherRuntime): void {
  safeWriteJson(runtime.parentLockFile, {
    pid: process.pid,
    plugin: 'miya',
    updatedAt: nowIso(),
  });
}

function connectWebSocket(runtime: LauncherRuntime, lock: DaemonLockState): void {
  const url = `ws://127.0.0.1:${lock.wsPort}/ws?token=${encodeURIComponent(runtime.daemonToken)}`;
  const ws = new WebSocket(url);
  runtime.ws = ws;

  ws.onopen = () => {
    runtime.connected = true;
    runtime.reconnectBackoffMs = 1_000;
    runtime.snapshot.statusText = 'Miya Daemon Connected';
    runtime.snapshot.connected = true;
    runtime.snapshot.port = lock.wsPort;
    runtime.snapshot.pid = lock.pid;
    const hello = DaemonHelloFrameSchema.parse({
      type: 'hello',
      clientID: `plugin-${process.pid}`,
      role: 'plugin',
      protocolVersion: '1.0',
      auth: { token: runtime.daemonToken },
    });
    ws.send(JSON.stringify(hello));
    startHeartbeat(runtime);
    startStatusPoll(runtime);
  };

  ws.onmessage = (event) => {
    const parsed = parseDaemonOutgoingFrame(event.data);
    if (!parsed.frame) return;
    const frame = parsed.frame;
    if (frame.type === 'pong') {
      runtime.lastPongAt = Date.now();
      if (runtime.pingWatchdog) clearTimeout(runtime.pingWatchdog);
      return;
    }
    if (frame.type === 'response') {
      if (frame.id === 'hello' && frame.ok) return;
      const pending = runtime.pending.get(frame.id);
      if (pending) {
        runtime.pending.delete(frame.id);
        clearTimeout(pending.timeout);
        if (frame.ok) {
          pending.resolve(frame.result);
        } else {
          pending.reject(new Error(frame.error?.message ?? 'daemon_request_failed'));
        }
      }
      return;
    }
    if (frame.type === 'event' && frame.event === 'daemon.ready') {
      runtime.snapshot.statusText = 'Miya Daemon Connected';
      runtime.snapshot.connected = true;
    }
  };

  ws.onerror = () => {
    runtime.connected = false;
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Reconnecting';
  };

  ws.onclose = () => {
    runtime.connected = false;
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Disconnected';
    stopHeartbeat(runtime);
    stopStatusPoll(runtime);
    scheduleReconnect(runtime);
  };
}

function daemonRequest(
  runtime: LauncherRuntime,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!runtime.ws || runtime.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('daemon_ws_not_open'));
  }
  if (runtime.pending.size >= runtime.maxPendingRequests) {
    return Promise.reject(
      new Error(
        `daemon_backpressure_overloaded:pending=${runtime.pending.size}:max=${runtime.maxPendingRequests}`,
      ),
    );
  }
  runtime.reqSeq += 1;
  const id = `req-${runtime.reqSeq}`;
  const frame = DaemonRequestFrameSchema.parse({
    type: 'request',
    id,
    method,
    params,
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      runtime.pending.delete(id);
      reject(new Error('daemon_request_timeout'));
    }, 8_000);
    runtime.pending.set(id, { resolve, reject, timeout });
    runtime.ws?.send(JSON.stringify(frame));
  });
}

function startHeartbeat(runtime: LauncherRuntime): void {
  stopHeartbeat(runtime);
  runtime.pingTimer = setInterval(() => {
    if (!runtime.ws || runtime.ws.readyState !== WebSocket.OPEN) return;
    const ping = DaemonPingFrameSchema.parse({
      type: 'ping',
      ts: Date.now(),
    });
    runtime.ws.send(JSON.stringify(ping));
    if (runtime.pingWatchdog) clearTimeout(runtime.pingWatchdog);
    runtime.pingWatchdog = setTimeout(() => {
      if (runtime.ws && runtime.ws.readyState === WebSocket.OPEN) {
        runtime.ws.close();
      }
    }, 30_000);
  }, 10_000);
}

function stopHeartbeat(runtime: LauncherRuntime): void {
  if (runtime.pingTimer) clearInterval(runtime.pingTimer);
  runtime.pingTimer = undefined;
  if (runtime.pingWatchdog) clearTimeout(runtime.pingWatchdog);
  runtime.pingWatchdog = undefined;
}

function startStatusPoll(runtime: LauncherRuntime): void {
  stopStatusPoll(runtime);
  runtime.statusTimer = setInterval(async () => {
    try {
      const data = (await daemonRequest(runtime, 'daemon.status.get', {})) as
        | Record<string, unknown>
        | undefined;
      if (!data || typeof data !== 'object') return;
      runtime.snapshot.connected = true;
      runtime.snapshot.statusText = 'Miya Daemon Connected';
      runtime.snapshot.uptimeSec =
        typeof data.uptimeSec === 'number' ? data.uptimeSec : runtime.snapshot.uptimeSec;
      runtime.snapshot.cpuPercent =
        typeof data.cpuPercent === 'number' ? data.cpuPercent : runtime.snapshot.cpuPercent;
      runtime.snapshot.vramUsedMB =
        typeof data.vramUsedMB === 'number' ? data.vramUsedMB : runtime.snapshot.vramUsedMB;
      runtime.snapshot.vramTotalMB =
        typeof data.vramTotalMB === 'number' ? data.vramTotalMB : runtime.snapshot.vramTotalMB;
      runtime.snapshot.lastSeenAt =
        typeof data.lastSeenAt === 'string' ? data.lastSeenAt : runtime.snapshot.lastSeenAt;
    } catch {
      runtime.snapshot.connected = false;
      runtime.snapshot.statusText = 'Miya Daemon Reconnecting';
    }
  }, 3_000);
}

function stopStatusPoll(runtime: LauncherRuntime): void {
  if (runtime.statusTimer) clearInterval(runtime.statusTimer);
  runtime.statusTimer = undefined;
}

function scheduleReconnect(runtime: LauncherRuntime): void {
  if (runtime.reconnectTimer) return;
  const wait = runtime.reconnectBackoffMs;
  runtime.reconnectBackoffMs = Math.min(runtime.reconnectBackoffMs * 2, 30_000);
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = undefined;
    ensureDaemonLaunched(runtime);
  }, wait);
}

function ensureDaemonLaunched(runtime: LauncherRuntime): void {
  writeParentLock(runtime);
  const lock = toDaemonLock(safeReadJson(runtime.daemonLockFile));
  const lockFresh =
    lock &&
    Number.isFinite(Date.parse(lock.updatedAt)) &&
    Date.now() - Date.parse(lock.updatedAt) < 30_000;
  const lockOwnedByLauncher = Boolean(lock) && lock?.token === runtime.daemonToken;

  if (!lockFresh || !lockOwnedByLauncher) {
    spawnDaemon(runtime);
    scheduleReconnect(runtime);
    return;
  }

  if (!runtime.ws || runtime.ws.readyState >= WebSocket.CLOSING) {
    connectWebSocket(runtime, lock);
  }
}

function cleanupRuntime(runtime: LauncherRuntime): void {
  if (runtime.parentBeatTimer) clearInterval(runtime.parentBeatTimer);
  runtime.parentBeatTimer = undefined;
  if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
  runtime.reconnectTimer = undefined;
  stopHeartbeat(runtime);
  stopStatusPoll(runtime);
  for (const pending of runtime.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('launcher_shutdown'));
  }
  runtime.pending.clear();
  try {
    runtime.ws?.close();
  } catch {}
  runtime.ws = undefined;
}

export function ensureMiyaLauncher(projectDir: string): DaemonConnectionSnapshot {
  const existing = runtimes.get(projectDir);
  if (existing) return { ...existing.snapshot };

  ensureDaemonDir(projectDir);
  const runtime: LauncherRuntime = {
    projectDir,
    daemonToken: randomUUID(),
    parentLockFile: path.join(daemonDir(projectDir), 'parent.lock.json'),
    daemonLockFile: path.join(daemonDir(projectDir), 'daemon.lock.json'),
    reconnectBackoffMs: 1_000,
    connected: false,
    reqSeq: 0,
    pending: new Map(),
    maxPendingRequests: Math.max(
      4,
      Math.floor(Number(process.env.MIYA_DAEMON_MAX_PENDING_REQUESTS ?? 64)),
    ),
    snapshot: {
      connected: false,
      statusText: 'Miya Daemon Booting',
      startedAt: nowIso(),
    },
  };
  runtimes.set(projectDir, runtime);

  writeParentLock(runtime);
  runtime.parentBeatTimer = setInterval(() => {
    writeParentLock(runtime);
  }, 10_000);
  ensureDaemonLaunched(runtime);
  return { ...runtime.snapshot };
}

export function getLauncherDaemonSnapshot(projectDir: string): DaemonConnectionSnapshot {
  const runtime = runtimes.get(projectDir);
  if (!runtime) {
    return {
      connected: false,
      statusText: 'Miya Daemon Not Started',
      startedAt: nowIso(),
    };
  }
  return { ...runtime.snapshot };
}

export function stopMiyaLauncher(projectDir: string): void {
  const runtime = runtimes.get(projectDir);
  if (!runtime) return;
  cleanupRuntime(runtime);
  try {
    fs.rmSync(runtime.parentLockFile, { force: true });
  } catch {}
  runtimes.delete(projectDir);
}

process.on('exit', () => {
  for (const runtime of runtimes.values()) {
    cleanupRuntime(runtime);
    try {
      fs.rmSync(runtime.parentLockFile, { force: true });
    } catch {}
  }
});
