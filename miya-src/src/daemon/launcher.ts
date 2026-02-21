import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../settings';
import { getMiyaRuntimeDir } from '../workflow';
import {
  DaemonHelloFrameSchema,
  DaemonPingFrameSchema,
  DaemonRequestFrameSchema,
  parseDaemonOutgoingFrame,
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
  lifecycleMode?: 'coupled' | 'service_experimental';
  port?: number;
  pid?: number;
  uptimeSec?: number;
  cpuPercent?: number;
  vramUsedMB?: number;
  vramTotalMB?: number;
  lastSeenAt?: string;
  activeJobID?: string;
  activeJobProgress?: number;
  pendingRequests: number;
  rejectedRequests: number;
  lastRejectReason?: string;
  startedAt: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface DaemonLauncherEvent {
  type: 'daemon.ready' | 'daemon.disconnected' | 'job.progress';
  at: string;
  payload?: Record<string, unknown>;
  snapshot: DaemonConnectionSnapshot;
}

type DaemonLauncherListener = (event: DaemonLauncherEvent) => void;

interface LauncherRuntime {
  projectDir: string;
  lifecycleMode: 'coupled' | 'service_experimental';
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
  rejectedRequests: number;
  lastRejectReason?: string;
  listeners: Set<DaemonLauncherListener>;
  snapshot: DaemonConnectionSnapshot;
  lastSpawnAttemptAtMs: number;
  launchCooldownUntilMs: number;
  consecutiveLaunchFailures: number;
  retryHalted: boolean;
  maxConsecutiveLaunchFailures: number;
}

export interface DaemonBackpressureStats {
  connected: boolean;
  maxPendingRequests: number;
  pendingRequests: number;
  rejectedRequests: number;
  lastRejectReason?: string;
}

const runtimes = new Map<string, LauncherRuntime>();
let resolvedNodeBinaryCache: string | undefined;

function emitLauncherEvent(
  runtime: LauncherRuntime,
  type: DaemonLauncherEvent['type'],
  payload?: Record<string, unknown>,
): void {
  if (runtime.listeners.size === 0) return;
  const event: DaemonLauncherEvent = {
    type,
    at: nowIso(),
    payload,
    snapshot: { ...runtime.snapshot },
  };
  for (const listener of runtime.listeners) {
    try {
      listener(event);
    } catch {}
  }
}

function syncBackpressureSnapshot(runtime: LauncherRuntime): void {
  runtime.snapshot.pendingRequests = runtime.pending.size;
  runtime.snapshot.rejectedRequests = runtime.rejectedRequests;
  runtime.snapshot.lastRejectReason = runtime.lastRejectReason;
}

function nowIso(): string {
  return new Date().toISOString();
}

function daemonDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'daemon');
}

function daemonPidFile(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'daemon.pid');
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toDaemonLock(
  raw: Record<string, unknown> | null,
): DaemonLockState | null {
  if (!raw) return null;
  const pid = Number(raw.pid);
  const wsPort = Number(raw.wsPort);
  const token = String(raw.token ?? '');
  const updatedAt = String(raw.updatedAt ?? '');
  if (!Number.isFinite(pid) || !Number.isFinite(wsPort) || !token || !updatedAt)
    return null;
  return { pid, wsPort, token, updatedAt };
}

function resolveHostScriptPath(projectDir: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'host.ts'),
    path.join(here, 'host.js'),
    path.join(projectDir, 'src', 'daemon', 'host.ts'),
    path.join(projectDir, 'dist', 'daemon', 'host.js'),
    path.join(projectDir, 'miya-src', 'src', 'daemon', 'host.ts'),
    path.join(projectDir, 'miya-src', 'dist', 'daemon', 'host.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(here, 'host.js');
}

function noteLaunchFailure(runtime: LauncherRuntime, reason: string): void {
  runtime.consecutiveLaunchFailures += 1;
  runtime.lastRejectReason = reason;
  if (
    runtime.consecutiveLaunchFailures >= runtime.maxConsecutiveLaunchFailures
  ) {
    runtime.retryHalted = true;
    runtime.connected = false;
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = `Miya Daemon Retry Halted (${reason})`;
  }
  syncBackpressureSnapshot(runtime);
}

function resetLaunchFailureState(runtime: LauncherRuntime): void {
  runtime.consecutiveLaunchFailures = 0;
  runtime.retryHalted = false;
  runtime.lastRejectReason = undefined;
  syncBackpressureSnapshot(runtime);
}

function resolveNodeBinary(): string | null {
  if (resolvedNodeBinaryCache !== undefined) return resolvedNodeBinaryCache;
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
      if (probe.status === 0) {
        resolvedNodeBinaryCache = candidate;
        return candidate;
      }
    } catch {}
  }
  return null;
}

function resolveLifecycleMode(
  projectDir: string,
): 'coupled' | 'service_experimental' {
  if (process.env.MIYA_DAEMON_LIFECYCLE_MODE === 'service')
    return 'service_experimental';
  if (process.env.MIYA_DAEMON_LIFECYCLE_MODE === 'coupled') return 'coupled';
  const config = readConfig(projectDir);
  const runtime = (config.runtime as Record<string, unknown> | undefined) ?? {};
  return runtime.service_mode_experimental === true
    ? 'service_experimental'
    : 'coupled';
}

function spawnDaemon(runtime: LauncherRuntime): boolean {
  if (runtime.retryHalted) {
    return false;
  }
  if (runtime.lifecycleMode === 'service_experimental') {
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Service Mode (attach only)';
    return false;
  }
  const now = Date.now();
  if (now - runtime.lastSpawnAttemptAtMs < 3_000) {
    return false;
  }
  runtime.lastSpawnAttemptAtMs = now;
  cleanupExistingDaemon(runtime.projectDir);
  const nodeBinary = resolveNodeBinary();
  if (!nodeBinary) {
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Disabled (node_not_found)';
    noteLaunchFailure(runtime, 'node_not_found');
    return false;
  }
  const binaryBase = path.basename(nodeBinary).toLowerCase();
  if (binaryBase.includes('powershell') || binaryBase === 'pwsh.exe') {
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText =
      'Miya Daemon Disabled (invalid_runtime_binary)';
    noteLaunchFailure(runtime, 'invalid_runtime_binary');
    return false;
  }
  const hostScript = resolveHostScriptPath(runtime.projectDir);
  const nodeArgs = [
    ...(hostScript.endsWith('.ts') ? ['--import', 'tsx'] : []),
    hostScript,
    '--project-dir',
    runtime.projectDir,
    '--parent-lock-file',
    runtime.parentLockFile,
    '--token',
    runtime.daemonToken,
  ];
  spawn(nodeBinary, nodeArgs, {
    cwd: path.dirname(hostScript),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  return true;
}

function readPidFile(projectDir: string): number | null {
  const file = daemonPidFile(projectDir);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf-8').trim();
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return pid;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupExistingDaemon(projectDir: string): void {
  const stalePid = readPidFile(projectDir);
  if (!stalePid || !isPidAlive(stalePid)) return;
  try {
    process.kill(stalePid);
  } catch {}
}

function writeParentLock(runtime: LauncherRuntime): void {
  safeWriteJson(runtime.parentLockFile, {
    pid: process.pid,
    plugin: 'miya',
    updatedAt: nowIso(),
  });
}

function connectWebSocket(
  runtime: LauncherRuntime,
  lock: DaemonLockState,
): void {
  const url = `ws://127.0.0.1:${lock.wsPort}/ws?token=${encodeURIComponent(runtime.daemonToken)}`;
  const ws = new WebSocket(url);
  runtime.ws = ws;

  ws.onopen = () => {
    resetLaunchFailureState(runtime);
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
        syncBackpressureSnapshot(runtime);
        if (frame.ok) {
          pending.resolve(frame.result);
        } else {
          pending.reject(
            new Error(frame.error?.message ?? 'daemon_request_failed'),
          );
        }
      }
      return;
    }
    if (frame.type === 'event' && frame.event === 'daemon.ready') {
      runtime.snapshot.statusText = 'Miya Daemon Connected';
      runtime.snapshot.connected = true;
      emitLauncherEvent(runtime, 'daemon.ready');
      return;
    }
    if (frame.type === 'event' && frame.event === 'job.progress') {
      const payload =
        frame.payload &&
        typeof frame.payload === 'object' &&
        !Array.isArray(frame.payload)
          ? (frame.payload as Record<string, unknown>)
          : {};
      runtime.snapshot.activeJobID =
        typeof payload.jobID === 'string'
          ? payload.jobID
          : runtime.snapshot.activeJobID;
      runtime.snapshot.activeJobProgress =
        typeof payload.progress === 'number'
          ? Math.floor(payload.progress)
          : runtime.snapshot.activeJobProgress;
      runtime.snapshot.statusText =
        typeof payload.status === 'string' && payload.status
          ? payload.status
          : runtime.snapshot.statusText;
      emitLauncherEvent(runtime, 'job.progress', payload);
    }
  };

  ws.onerror = () => {
    runtime.connected = false;
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Reconnecting';
  };

  ws.onclose = () => {
    noteLaunchFailure(runtime, 'ws_closed');
    runtime.connected = false;
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Disconnected';
    emitLauncherEvent(runtime, 'daemon.disconnected');
    stopHeartbeat(runtime);
    stopStatusPoll(runtime);
    scheduleReconnect(runtime);
  };
}

function daemonRequest(
  runtime: LauncherRuntime,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 8_000,
): Promise<unknown> {
  if (!runtime.ws || runtime.ws.readyState !== WebSocket.OPEN) {
    runtime.lastRejectReason = 'ws_not_open';
    runtime.rejectedRequests += 1;
    syncBackpressureSnapshot(runtime);
    return Promise.reject(new Error('daemon_ws_not_open'));
  }
  if (runtime.pending.size >= runtime.maxPendingRequests) {
    runtime.lastRejectReason = 'overloaded';
    runtime.rejectedRequests += 1;
    syncBackpressureSnapshot(runtime);
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
    const timeout = setTimeout(
      () => {
        runtime.pending.delete(id);
        runtime.lastRejectReason = 'timeout';
        runtime.rejectedRequests += 1;
        syncBackpressureSnapshot(runtime);
        reject(new Error('daemon_request_timeout'));
      },
      Math.max(1_000, timeoutMs),
    );
    runtime.pending.set(id, { resolve, reject, timeout });
    syncBackpressureSnapshot(runtime);
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
        typeof data.uptimeSec === 'number'
          ? data.uptimeSec
          : runtime.snapshot.uptimeSec;
      runtime.snapshot.cpuPercent =
        typeof data.cpuPercent === 'number'
          ? data.cpuPercent
          : runtime.snapshot.cpuPercent;
      runtime.snapshot.vramUsedMB =
        typeof data.vramUsedMB === 'number'
          ? data.vramUsedMB
          : runtime.snapshot.vramUsedMB;
      runtime.snapshot.vramTotalMB =
        typeof data.vramTotalMB === 'number'
          ? data.vramTotalMB
          : runtime.snapshot.vramTotalMB;
      runtime.snapshot.lastSeenAt =
        typeof data.lastSeenAt === 'string'
          ? data.lastSeenAt
          : runtime.snapshot.lastSeenAt;
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
  if (runtime.retryHalted) return;
  if (runtime.reconnectTimer) return;
  const wait = runtime.reconnectBackoffMs;
  runtime.reconnectBackoffMs = Math.min(runtime.reconnectBackoffMs * 2, 30_000);
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = undefined;
    ensureDaemonLaunched(runtime);
  }, wait);
}

function ensureDaemonLaunched(runtime: LauncherRuntime): void {
  if (runtime.retryHalted) {
    return;
  }
  writeParentLock(runtime);
  if (Date.now() < runtime.launchCooldownUntilMs) {
    return;
  }
  const lock = toDaemonLock(safeReadJson(runtime.daemonLockFile));
  const lockFresh =
    lock &&
    Number.isFinite(Date.parse(lock.updatedAt)) &&
    Date.now() - Date.parse(lock.updatedAt) < 30_000;
  const lockOwnedByLauncher =
    runtime.lifecycleMode === 'service_experimental'
      ? Boolean(lock) &&
        (runtime.daemonToken ? lock?.token === runtime.daemonToken : true)
      : Boolean(lock) && lock?.token === runtime.daemonToken;

  if (!lockFresh || !lockOwnedByLauncher) {
    if (runtime.lifecycleMode === 'service_experimental') {
      runtime.snapshot.connected = false;
      runtime.snapshot.statusText =
        'Miya Daemon Service Mode (waiting for daemon lock)';
      scheduleReconnect(runtime);
      return;
    }
    if (runtime.reconnectTimer) {
      return;
    }
    const spawned = spawnDaemon(runtime);
    if (!spawned) {
      runtime.reconnectBackoffMs = Math.max(runtime.reconnectBackoffMs, 15_000);
      runtime.launchCooldownUntilMs = Date.now() + 15_000;
      if (!runtime.retryHalted) {
        noteLaunchFailure(runtime, 'spawn_skipped_or_failed');
      }
    }
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
  syncBackpressureSnapshot(runtime);
  runtime.listeners.clear();
  try {
    runtime.ws?.close();
  } catch {}
  runtime.ws = undefined;
}

export function ensureMiyaLauncher(
  projectDir: string,
): DaemonConnectionSnapshot {
  const existing = runtimes.get(projectDir);
  if (existing) return { ...existing.snapshot };

  ensureDaemonDir(projectDir);
  const lifecycleMode = resolveLifecycleMode(projectDir);
  const config = readConfig(projectDir);
  const backpressure = (config.runtime as Record<string, unknown> | undefined)
    ?.backpressure as Record<string, unknown> | undefined;
  const configuredMaxPending =
    typeof backpressure?.daemon_max_pending_requests === 'number'
      ? Number(backpressure.daemon_max_pending_requests)
      : Number(process.env.MIYA_DAEMON_MAX_PENDING_REQUESTS ?? 64);
  const configuredMaxFailures =
    typeof backpressure?.daemon_max_consecutive_failures === 'number'
      ? Number(backpressure.daemon_max_consecutive_failures)
      : Number(process.env.MIYA_DAEMON_MAX_CONSECUTIVE_FAILURES ?? 5);
  const daemonToken =
    lifecycleMode === 'service_experimental'
      ? String(
          process.env.MIYA_DAEMON_SERVICE_TOKEN ??
            process.env.MIYA_DAEMON_TOKEN ??
            '',
        )
      : randomUUID();
  const runtime: LauncherRuntime = {
    projectDir,
    lifecycleMode,
    daemonToken,
    parentLockFile: path.join(daemonDir(projectDir), 'parent.lock.json'),
    daemonLockFile: path.join(daemonDir(projectDir), 'daemon.lock.json'),
    reconnectBackoffMs: 1_000,
    connected: false,
    reqSeq: 0,
    pending: new Map(),
    maxPendingRequests: Math.max(4, Math.floor(configuredMaxPending)),
    rejectedRequests: 0,
    lastRejectReason: undefined,
    listeners: new Set(),
    lastSpawnAttemptAtMs: 0,
    launchCooldownUntilMs: 0,
    consecutiveLaunchFailures: 0,
    retryHalted: false,
    maxConsecutiveLaunchFailures: Math.max(
      1,
      Math.floor(configuredMaxFailures),
    ),
    snapshot: {
      connected: false,
      statusText:
        lifecycleMode === 'service_experimental'
          ? daemonToken
            ? 'Miya Daemon Service Mode (attach only)'
            : 'Miya Daemon Service Mode (token missing)'
          : 'Miya Daemon Booting',
      lifecycleMode,
      pendingRequests: 0,
      rejectedRequests: 0,
      startedAt: nowIso(),
    },
  };
  syncBackpressureSnapshot(runtime);
  runtimes.set(projectDir, runtime);

  writeParentLock(runtime);
  runtime.parentBeatTimer = setInterval(() => {
    writeParentLock(runtime);
  }, 10_000);
  ensureDaemonLaunched(runtime);
  return { ...runtime.snapshot };
}

export function getLauncherDaemonSnapshot(
  projectDir: string,
): DaemonConnectionSnapshot {
  const runtime = runtimes.get(projectDir);
  if (!runtime) {
    return {
      connected: false,
      statusText: 'Miya Daemon Not Started',
      pendingRequests: 0,
      rejectedRequests: 0,
      startedAt: nowIso(),
    };
  }
  syncBackpressureSnapshot(runtime);
  return { ...runtime.snapshot };
}

export function getLauncherBackpressureStats(
  projectDir: string,
): DaemonBackpressureStats {
  const runtime = runtimes.get(projectDir);
  if (!runtime) {
    return {
      connected: false,
      maxPendingRequests: Math.max(
        4,
        Math.floor(Number(process.env.MIYA_DAEMON_MAX_PENDING_REQUESTS ?? 64)),
      ),
      pendingRequests: 0,
      rejectedRequests: 0,
    };
  }
  syncBackpressureSnapshot(runtime);
  return {
    connected: runtime.connected,
    maxPendingRequests: runtime.maxPendingRequests,
    pendingRequests: runtime.snapshot.pendingRequests,
    rejectedRequests: runtime.snapshot.rejectedRequests,
    lastRejectReason: runtime.snapshot.lastRejectReason,
  };
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

export function subscribeLauncherEvents(
  projectDir: string,
  listener: DaemonLauncherListener,
): () => void {
  ensureMiyaLauncher(projectDir);
  const runtime = runtimes.get(projectDir);
  if (!runtime) return () => {};
  runtime.listeners.add(listener);
  return () => {
    const current = runtimes.get(projectDir);
    current?.listeners.delete(listener);
  };
}

async function waitForDaemonConnection(
  runtime: LauncherRuntime,
  timeoutMs: number,
): Promise<void> {
  if (runtime.ws?.readyState === WebSocket.OPEN && runtime.connected) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    ensureDaemonLaunched(runtime);
    if (runtime.ws?.readyState === WebSocket.OPEN && runtime.connected) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('daemon_connect_timeout');
}

export async function daemonInvoke(
  projectDir: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<unknown> {
  ensureMiyaLauncher(projectDir);
  const runtime = runtimes.get(projectDir);
  if (!runtime) throw new Error('daemon_runtime_missing');
  await waitForDaemonConnection(runtime, Math.min(timeoutMs, 15_000));
  return daemonRequest(runtime, method, params, timeoutMs);
}

process.on('exit', () => {
  for (const runtime of runtimes.values()) {
    cleanupRuntime(runtime);
    try {
      fs.rmSync(runtime.parentLockFile, { force: true });
    } catch {}
  }
});
