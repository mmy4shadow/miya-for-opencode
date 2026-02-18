import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../settings';
import { safeInterval } from '../utils/safe-interval';
import { getMiyaRuntimeDir } from '../workflow';
import {
  DaemonHelloFrameSchema,
  DaemonPingFrameSchema,
  DaemonRequestFrameSchema,
  DaemonResponseFrameSchema,
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
  desiredState: 'running' | 'stopped';
  lifecycleState:
    | 'STOPPED'
    | 'STARTING'
    | 'CONNECTED'
    | 'DEGRADED'
    | 'BACKOFF'
    | 'STOPPING';
  runEpoch: number;
  retryHalted: boolean;
  retryHaltedUntil?: string;
  manualStopUntil?: string;
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
  psycheSignalHub?: {
    running: boolean;
    sequence: number;
    sampledAt?: string;
    ageMs: number;
    stale: boolean;
    consecutiveFailures: number;
    lastError?: string;
    sampleIntervalMs: number;
    burstIntervalMs: number;
    staleAfterMs: number;
  };
  startedAt: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type LauncherDesiredState = 'running' | 'stopped';
type LauncherLifecycleState =
  | 'STOPPED'
  | 'STARTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'BACKOFF'
  | 'STOPPING';

interface LauncherPersistedState {
  desiredState: LauncherDesiredState;
  runEpoch: number;
  retryHalted: boolean;
  retryHaltedUntilMs: number;
  consecutiveLaunchFailures: number;
  lastRejectReason?: string;
  manualStopUntilMs: number;
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
  desiredState: LauncherDesiredState;
  lifecycleState: LauncherLifecycleState;
  runEpoch: number;
  parentLockFile: string;
  daemonLockFile: string;
  runtimeStoreFile: string;
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
  manualStopUntilMs: number;
  manualStopCooldownMs: number;
  consecutiveLaunchFailures: number;
  retryHalted: boolean;
  retryHaltedUntilMs: number;
  retryHaltCooldownMs: number;
  maxConsecutiveLaunchFailures: number;
  lastAccessAtMs: number;
}

export interface DaemonBackpressureStats {
  connected: boolean;
  maxPendingRequests: number;
  pendingRequests: number;
  rejectedRequests: number;
  lastRejectReason?: string;
}

const runtimes = new Map<string, LauncherRuntime>();

function launcherIdlePruneMs(): number {
  return Math.max(
    5_000,
    Number(process.env.MIYA_DAEMON_IDLE_PRUNE_MS ?? 15_000),
  );
}

function touchRuntime(runtime: LauncherRuntime): void {
  runtime.lastAccessAtMs = Date.now();
}

function pruneIdleRuntimes(exceptProjectDir?: string): void {
  const now = Date.now();
  const idleMs = launcherIdlePruneMs();
  for (const [projectDir, runtime] of runtimes) {
    if (exceptProjectDir && projectDir === exceptProjectDir) continue;
    if (runtime.pending.size > 0) continue;
    if (runtime.listeners.size > 0) continue;
    if (now - runtime.lastAccessAtMs < idleMs) continue;
    cleanupRuntime(runtime);
    if (runtime.lifecycleMode !== 'service_experimental') {
      cleanupExistingDaemon(projectDir);
    }
    try {
      fs.rmSync(runtime.parentLockFile, { force: true });
    } catch {}
    runtimes.delete(projectDir);
  }
}

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

function parsePsycheSignalHubSnapshot(
  raw: unknown,
): DaemonConnectionSnapshot['psycheSignalHub'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const running = row.running === true;
  const sequence = Number(row.sequence);
  const ageMs = Number(row.ageMs);
  const stale = row.stale === true;
  const consecutiveFailures = Number(row.consecutiveFailures);
  const sampleIntervalMs = Number(row.sampleIntervalMs);
  const burstIntervalMs = Number(row.burstIntervalMs);
  const staleAfterMs = Number(row.staleAfterMs);
  if (
    !Number.isFinite(sequence) ||
    !Number.isFinite(ageMs) ||
    !Number.isFinite(consecutiveFailures) ||
    !Number.isFinite(sampleIntervalMs) ||
    !Number.isFinite(burstIntervalMs) ||
    !Number.isFinite(staleAfterMs)
  ) {
    return undefined;
  }
  return {
    running,
    sequence: Math.max(0, Math.floor(sequence)),
    sampledAt: typeof row.sampledAt === 'string' ? row.sampledAt : undefined,
    ageMs: Math.max(0, Math.floor(ageMs)),
    stale,
    consecutiveFailures: Math.max(0, Math.floor(consecutiveFailures)),
    lastError:
      typeof row.lastError === 'string' && row.lastError.trim().length > 0
        ? row.lastError.trim()
        : undefined,
    sampleIntervalMs: Math.max(0, Math.floor(sampleIntervalMs)),
    burstIntervalMs: Math.max(0, Math.floor(burstIntervalMs)),
    staleAfterMs: Math.max(0, Math.floor(staleAfterMs)),
  };
}

function daemonDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'daemon');
}

function daemonPidFile(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'daemon.pid');
}

function daemonLauncherStoreFile(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'launcher.runtime.json');
}

function daemonLogFile(projectDir: string, kind: 'stdout' | 'stderr'): string {
  return path.join(daemonDir(projectDir), kind === 'stdout' ? 'host.stdout.log' : 'host.stderr.log');
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

function readLauncherPersistedState(
  projectDir: string,
): LauncherPersistedState {
  const parsed = safeReadJson(daemonLauncherStoreFile(projectDir));
  const desiredState =
    parsed?.desiredState === 'stopped' || parsed?.desired_state === 'stopped'
      ? 'stopped'
      : 'running';
  return {
    desiredState,
    runEpoch: Math.max(1, Math.floor(Number(parsed?.runEpoch ?? 1))),
    retryHalted: parsed?.retryHalted === true,
    retryHaltedUntilMs: Math.max(
      0,
      Math.floor(Number(parsed?.retryHaltedUntilMs ?? 0)),
    ),
    consecutiveLaunchFailures: Math.max(
      0,
      Math.floor(Number(parsed?.consecutiveLaunchFailures ?? 0)),
    ),
    lastRejectReason:
      typeof parsed?.lastRejectReason === 'string' &&
      parsed.lastRejectReason.trim().length > 0
        ? parsed.lastRejectReason
        : undefined,
    manualStopUntilMs: Math.max(
      0,
      Math.floor(Number(parsed?.manualStopUntilMs ?? 0)),
    ),
  };
}

function writeLauncherPersistedState(runtime: LauncherRuntime): void {
  safeWriteJson(runtime.runtimeStoreFile, {
    desiredState: runtime.desiredState,
    runEpoch: runtime.runEpoch,
    retryHalted: runtime.retryHalted,
    retryHaltedUntilMs: runtime.retryHaltedUntilMs,
    consecutiveLaunchFailures: runtime.consecutiveLaunchFailures,
    lastRejectReason: runtime.lastRejectReason,
    manualStopUntilMs: runtime.manualStopUntilMs,
    updatedAt: nowIso(),
  });
}

function resolveHostScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tsFile = path.join(here, 'host.ts');
  const jsFile = path.join(here, 'host.js');
  if (fs.existsSync(tsFile)) return tsFile;
  return jsFile;
}

function noteLaunchFailure(runtime: LauncherRuntime, reason: string): void {
  runtime.consecutiveLaunchFailures += 1;
  runtime.lastRejectReason = reason;
  if (
    runtime.consecutiveLaunchFailures >= runtime.maxConsecutiveLaunchFailures
  ) {
    runtime.retryHalted = true;
    runtime.retryHaltedUntilMs = Date.now() + runtime.retryHaltCooldownMs;
    runtime.connected = false;
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = `Miya Daemon Retry Halted (${reason})`;
    setLifecycleState(runtime, 'BACKOFF', runtime.snapshot.statusText);
  } else if (
    runtime.lifecycleState !== 'STOPPING' &&
    runtime.lifecycleState !== 'STOPPED'
  ) {
    setLifecycleState(runtime, 'DEGRADED', 'Miya Daemon Reconnecting');
  }
  writeLauncherPersistedState(runtime);
  syncBackpressureSnapshot(runtime);
}

function resetLaunchFailureState(runtime: LauncherRuntime): void {
  runtime.consecutiveLaunchFailures = 0;
  runtime.retryHalted = false;
  runtime.retryHaltedUntilMs = 0;
  runtime.lastRejectReason = undefined;
  writeLauncherPersistedState(runtime);
  syncBackpressureSnapshot(runtime);
}

function resolveBunBinary(): string | null {
  if (process.platform === 'win32') {
    const byExe = Bun.which('bun.exe');
    if (byExe) return byExe;
    const byBun = Bun.which('bun');
    if (byBun) {
      if (byBun.toLowerCase().endsWith('.cmd')) {
        const exeCandidate = byBun.slice(0, -4) + '.exe';
        if (fs.existsSync(exeCandidate)) return exeCandidate;
      }
      return byBun;
    }
  } else {
    const byWhich = Bun.which('bun') ?? Bun.which('bun.exe');
    if (byWhich) return byWhich;
  }
  const execBase = path.basename(process.execPath).toLowerCase();
  if (execBase === 'bun' || execBase === 'bun.exe') return process.execPath;
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

function syncLifecycleSnapshot(runtime: LauncherRuntime): void {
  runtime.snapshot.desiredState = runtime.desiredState;
  runtime.snapshot.lifecycleState = runtime.lifecycleState;
  runtime.snapshot.runEpoch = runtime.runEpoch;
  runtime.snapshot.retryHalted = runtime.retryHalted;
  runtime.snapshot.retryHaltedUntil =
    runtime.retryHaltedUntilMs > 0
      ? new Date(runtime.retryHaltedUntilMs).toISOString()
      : undefined;
  runtime.snapshot.manualStopUntil =
    runtime.manualStopUntilMs > 0
      ? new Date(runtime.manualStopUntilMs).toISOString()
      : undefined;
}

function setLifecycleState(
  runtime: LauncherRuntime,
  state: LauncherLifecycleState,
  statusText?: string,
): void {
  runtime.lifecycleState = state;
  if (typeof statusText === 'string' && statusText.trim().length > 0) {
    runtime.snapshot.statusText = statusText;
  }
  syncLifecycleSnapshot(runtime);
}

function shouldRunForEpoch(runtime: LauncherRuntime, epoch: number): boolean {
  if (runtime.desiredState !== 'running') return false;
  if (runtime.runEpoch !== epoch) return false;
  if (Date.now() < runtime.manualStopUntilMs) return false;
  if (runtime.retryHalted) {
    if (
      runtime.retryHaltedUntilMs > 0 &&
      Date.now() >= runtime.retryHaltedUntilMs
    ) {
      resetLaunchFailureState(runtime);
      writeLauncherPersistedState(runtime);
      return true;
    }
    return false;
  }
  return true;
}

function requestRunningState(
  runtime: LauncherRuntime,
  options?: { explicit?: boolean },
): number {
  const explicit = options?.explicit === true;
  let changed = false;
  if (explicit) {
    if (runtime.manualStopUntilMs !== 0) {
      runtime.manualStopUntilMs = 0;
      changed = true;
    }
    if (runtime.launchCooldownUntilMs !== 0) {
      runtime.launchCooldownUntilMs = 0;
      changed = true;
    }
    if (
      runtime.retryHalted ||
      runtime.retryHaltedUntilMs > 0 ||
      runtime.consecutiveLaunchFailures > 0 ||
      runtime.lastRejectReason
    ) {
      runtime.consecutiveLaunchFailures = 0;
      runtime.retryHalted = false;
      runtime.retryHaltedUntilMs = 0;
      runtime.lastRejectReason = undefined;
      changed = true;
      syncBackpressureSnapshot(runtime);
    }
  }
  if (runtime.desiredState !== 'running') {
    runtime.desiredState = 'running';
    runtime.runEpoch += 1;
    changed = true;
    if (
      runtime.lifecycleState === 'STOPPED' ||
      runtime.lifecycleState === 'STOPPING'
    ) {
      setLifecycleState(runtime, 'STARTING', 'Miya Daemon Booting');
    }
  } else if (
    runtime.lifecycleState === 'STOPPED' ||
    runtime.lifecycleState === 'STOPPING'
  ) {
    setLifecycleState(runtime, 'STARTING', 'Miya Daemon Booting');
    changed = true;
  }
  if (changed) {
    writeLauncherPersistedState(runtime);
  }
  syncLifecycleSnapshot(runtime);
  return runtime.runEpoch;
}

type SpawnResult = 'spawned' | 'skipped' | 'failed';

function spawnDaemon(runtime: LauncherRuntime): SpawnResult {
  const epoch = runtime.runEpoch;
  if (!shouldRunForEpoch(runtime, epoch)) {
    return 'skipped';
  }
  if (runtime.lifecycleMode === 'service_experimental') {
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Service Mode (attach only)';
    return 'skipped';
  }
  const now = Date.now();
  if (now - runtime.lastSpawnAttemptAtMs < 3_000) {
    return 'skipped';
  }
  runtime.lastSpawnAttemptAtMs = now;
  cleanupExistingDaemon(runtime.projectDir);
  const bunBinary = resolveBunBinary();
  if (!bunBinary) {
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText = 'Miya Daemon Disabled (bun_not_found)';
    noteLaunchFailure(runtime, 'bun_not_found');
    return 'failed';
  }
  const binaryBase = path.basename(bunBinary).toLowerCase();
  if (binaryBase.includes('powershell') || binaryBase === 'pwsh.exe') {
    runtime.snapshot.connected = false;
    runtime.snapshot.statusText =
      'Miya Daemon Disabled (invalid_runtime_binary)';
    noteLaunchFailure(runtime, 'invalid_runtime_binary');
    return 'failed';
  }
  const hostScript = resolveHostScriptPath();
  const hostStdout = fs.openSync(daemonLogFile(runtime.projectDir, 'stdout'), 'a');
  const hostStderr = fs.openSync(daemonLogFile(runtime.projectDir, 'stderr'), 'a');
  const child = spawn(
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
      stdio: ['ignore', hostStdout, hostStderr],
      windowsHide: true,
    },
  );
  child.unref();
  try {
    fs.closeSync(hostStdout);
  } catch {}
  try {
    fs.closeSync(hostStderr);
  } catch {}
  setLifecycleState(runtime, 'STARTING', 'Miya Daemon Booting');
  return 'spawned';
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
  epoch: number,
): void {
  if (!shouldRunForEpoch(runtime, epoch)) return;
  const url = `ws://127.0.0.1:${lock.wsPort}/ws?token=${encodeURIComponent(runtime.daemonToken)}`;
  const ws = new WebSocket(url);
  runtime.ws = ws;
  setLifecycleState(runtime, 'STARTING', 'Miya Daemon Connecting');

  ws.onopen = () => {
    if (!shouldRunForEpoch(runtime, epoch)) {
      try {
        ws.close();
      } catch {}
      return;
    }
    resetLaunchFailureState(runtime);
    runtime.connected = true;
    runtime.reconnectBackoffMs = 1_000;
    runtime.snapshot.statusText = 'Miya Daemon Connected';
    runtime.snapshot.connected = true;
    runtime.snapshot.port = lock.wsPort;
    runtime.snapshot.pid = lock.pid;
    setLifecycleState(runtime, 'CONNECTED', runtime.snapshot.statusText);
    const hello = DaemonHelloFrameSchema.parse({
      type: 'hello',
      clientID: `plugin-${process.pid}`,
      role: 'plugin',
      protocolVersion: '1.0',
      auth: { token: runtime.daemonToken },
    });
    ws.send(JSON.stringify(hello));
    startHeartbeat(runtime);
    startStatusPoll(runtime, epoch);
  };

  ws.onmessage = (event) => {
    if (runtime.runEpoch !== epoch) return;
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
    if (runtime.runEpoch !== epoch) return;
    dispatchLifecycleEvent(runtime, {
      type: 'ws.error',
      epoch,
      reason: 'ws_error',
    });
  };

  ws.onclose = () => {
    if (runtime.runEpoch !== epoch) return;
    dispatchLifecycleEvent(runtime, {
      type: 'ws.closed',
      epoch,
      reason: 'ws_closed',
    });
  };
}

function daemonRequest(
  runtime: LauncherRuntime,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 8_000,
): Promise<unknown> {
  touchRuntime(runtime);
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
  runtime.pingTimer = safeInterval('launcher.ping', 10_000, () => {
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
  });
}

function stopHeartbeat(runtime: LauncherRuntime): void {
  if (runtime.pingTimer) clearInterval(runtime.pingTimer);
  runtime.pingTimer = undefined;
  if (runtime.pingWatchdog) clearTimeout(runtime.pingWatchdog);
  runtime.pingWatchdog = undefined;
}

function startStatusPoll(runtime: LauncherRuntime, epoch: number): void {
  stopStatusPoll(runtime);
  runtime.statusTimer = safeInterval(
    'launcher.status.poll',
    3_000,
    async () => {
      if (!shouldRunForEpoch(runtime, epoch)) return;
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
        runtime.snapshot.psycheSignalHub =
          parsePsycheSignalHubSnapshot(
            (data as Record<string, unknown>).psycheSignalHub,
          ) ?? runtime.snapshot.psycheSignalHub;
      } catch (error) {
        dispatchLifecycleEvent(runtime, {
          type: 'health.fail',
          epoch,
          reason:
            error instanceof Error && error.message.trim().length > 0
              ? `status_poll:${error.message.trim()}`
              : 'status_poll_failed',
        });
      }
    },
  );
}

function stopStatusPoll(runtime: LauncherRuntime): void {
  if (runtime.statusTimer) clearInterval(runtime.statusTimer);
  runtime.statusTimer = undefined;
}

function rejectPendingRequests(runtime: LauncherRuntime, reason: string): void {
  for (const [requestID, pending] of runtime.pending) {
    runtime.pending.delete(requestID);
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  syncBackpressureSnapshot(runtime);
}

type LauncherLifecycleEvent =
  | {
      type: 'reconnect.requested';
      epoch: number;
      reason?: string;
      waitMs?: number;
    }
  | { type: 'reconnect.timer'; epoch: number; reason?: string }
  | { type: 'ws.closed'; epoch: number; reason?: string }
  | { type: 'ws.error'; epoch: number; reason?: string }
  | { type: 'health.fail'; epoch: number; reason?: string };

function scheduleReconnect(
  runtime: LauncherRuntime,
  event: {
    epoch: number;
    reason?: string;
    waitMs?: number;
  },
): void {
  const epoch = event.epoch;
  if (!shouldRunForEpoch(runtime, epoch)) return;
  if (runtime.reconnectTimer) return;
  const wait = Math.max(
    250,
    Math.min(
      30_000,
      typeof event.waitMs === 'number' && Number.isFinite(event.waitMs)
        ? Math.floor(event.waitMs)
        : runtime.reconnectBackoffMs,
    ),
  );
  runtime.reconnectBackoffMs = Math.min(Math.max(500, wait) * 2, 30_000);
  setLifecycleState(runtime, 'BACKOFF', `Miya Daemon Backoff (${wait}ms)`);
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = undefined;
    dispatchLifecycleEvent(runtime, {
      type: 'reconnect.timer',
      epoch,
      reason: event.reason,
    });
  }, wait);
}

function dispatchLifecycleEvent(
  runtime: LauncherRuntime,
  event: LauncherLifecycleEvent,
): void {
  if (event.epoch !== runtime.runEpoch) return;
  switch (event.type) {
    case 'reconnect.requested': {
      scheduleReconnect(runtime, {
        epoch: event.epoch,
        reason: event.reason,
        waitMs: event.waitMs,
      });
      return;
    }
    case 'reconnect.timer': {
      if (!shouldRunForEpoch(runtime, event.epoch)) return;
      ensureDaemonLaunched(runtime, event.epoch);
      return;
    }
    case 'ws.closed': {
      if (!shouldRunForEpoch(runtime, event.epoch)) return;
      noteLaunchFailure(runtime, event.reason ?? 'ws_closed');
      runtime.connected = false;
      runtime.snapshot.connected = false;
      runtime.snapshot.statusText = 'Miya Daemon Disconnected';
      setLifecycleState(runtime, 'DEGRADED', runtime.snapshot.statusText);
      emitLauncherEvent(runtime, 'daemon.disconnected');
      stopHeartbeat(runtime);
      stopStatusPoll(runtime);
      rejectPendingRequests(runtime, 'daemon_ws_closed');
      runtime.ws = undefined;
      dispatchLifecycleEvent(runtime, {
        type: 'reconnect.requested',
        epoch: event.epoch,
        reason: event.reason ?? 'ws_closed',
      });
      return;
    }
    case 'ws.error':
    case 'health.fail': {
      if (!shouldRunForEpoch(runtime, event.epoch)) return;
      runtime.connected = false;
      runtime.snapshot.connected = false;
      runtime.snapshot.statusText = 'Miya Daemon Reconnecting';
      if (
        runtime.lifecycleState !== 'STOPPED' &&
        runtime.lifecycleState !== 'STOPPING'
      ) {
        setLifecycleState(runtime, 'DEGRADED', runtime.snapshot.statusText);
      }
      if (runtime.ws && runtime.ws.readyState <= WebSocket.OPEN) {
        try {
          runtime.ws.close();
        } catch {}
      }
      dispatchLifecycleEvent(runtime, {
        type: 'reconnect.requested',
        epoch: event.epoch,
        reason: event.reason ?? event.type,
      });
      return;
    }
  }
}

function ensureDaemonLaunched(
  runtime: LauncherRuntime,
  epoch = runtime.runEpoch,
): void {
  if (!shouldRunForEpoch(runtime, epoch)) {
    if (Date.now() < runtime.manualStopUntilMs) {
      setLifecycleState(runtime, 'STOPPED', 'Miya Daemon Manual Cooldown');
      runtime.snapshot.connected = false;
    } else if (runtime.retryHalted) {
      setLifecycleState(runtime, 'BACKOFF', 'Miya Daemon Retry Halted');
      runtime.snapshot.connected = false;
    } else if (runtime.desiredState === 'stopped') {
      setLifecycleState(runtime, 'STOPPED', 'Miya Daemon Stopped');
      runtime.snapshot.connected = false;
    }
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
      setLifecycleState(runtime, 'BACKOFF', runtime.snapshot.statusText);
      dispatchLifecycleEvent(runtime, {
        type: 'reconnect.requested',
        epoch,
        reason: 'service_mode_wait_lock',
      });
      return;
    }
    if (runtime.reconnectTimer) {
      return;
    }
    const spawnResult = spawnDaemon(runtime);
    if (spawnResult === 'failed') {
      runtime.reconnectBackoffMs = Math.max(runtime.reconnectBackoffMs, 15_000);
      runtime.launchCooldownUntilMs = Date.now() + 15_000;
    }
    dispatchLifecycleEvent(runtime, {
      type: 'reconnect.requested',
      epoch,
      reason: `spawn_${spawnResult}`,
    });
    return;
  }

  if (!runtime.ws || runtime.ws.readyState >= WebSocket.CLOSING) {
    connectWebSocket(runtime, lock, epoch);
  }
}

function cleanupRuntime(runtime: LauncherRuntime): void {
  setLifecycleState(runtime, 'STOPPING', 'Miya Daemon Stopping');
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
  runtime.connected = false;
  runtime.snapshot.connected = false;
  setLifecycleState(runtime, 'STOPPED', 'Miya Daemon Stopped');
}

export function ensureMiyaLauncher(
  projectDir: string,
): DaemonConnectionSnapshot {
  pruneIdleRuntimes(projectDir);
  const existing = runtimes.get(projectDir);
  if (existing) {
    touchRuntime(existing);
    const shouldWake = existing.desiredState === 'running';
    if (shouldWake) {
      const epoch = requestRunningState(existing);
      ensureDaemonLaunched(existing, epoch);
    } else {
      existing.connected = false;
      existing.snapshot.connected = false;
      if (Date.now() < existing.manualStopUntilMs) {
        setLifecycleState(existing, 'STOPPED', 'Miya Daemon Manual Cooldown');
      } else {
        setLifecycleState(existing, 'STOPPED', 'Miya Daemon Stopped');
      }
    }
    syncBackpressureSnapshot(existing);
    return { ...existing.snapshot };
  }

  ensureDaemonDir(projectDir);
  const lifecycleMode = resolveLifecycleMode(projectDir);
  const config = readConfig(projectDir);
  const persisted = readLauncherPersistedState(projectDir);
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
  const configuredManualStopCooldown =
    typeof backpressure?.daemon_manual_stop_cooldown_ms === 'number'
      ? Number(backpressure.daemon_manual_stop_cooldown_ms)
      : Number(process.env.MIYA_DAEMON_MANUAL_STOP_COOLDOWN_MS ?? 180_000);
  const configuredRetryHaltCooldown =
    typeof backpressure?.daemon_retry_halt_cooldown_ms === 'number'
      ? Number(backpressure.daemon_retry_halt_cooldown_ms)
      : Number(process.env.MIYA_DAEMON_RETRY_HALT_COOLDOWN_MS ?? 300_000);
  const daemonToken =
    lifecycleMode === 'service_experimental'
      ? String(
          process.env.MIYA_DAEMON_SERVICE_TOKEN ??
            process.env.MIYA_DAEMON_TOKEN ??
            '',
        )
      : randomUUID();
  const desiredState: LauncherDesiredState = persisted.desiredState;
  const initialLifecycleState: LauncherLifecycleState =
    desiredState === 'stopped'
      ? 'STOPPED'
      : persisted.retryHalted
        ? 'BACKOFF'
        : 'STARTING';
  const initialStatusText =
    lifecycleMode === 'service_experimental'
      ? daemonToken
        ? 'Miya Daemon Service Mode (attach only)'
        : 'Miya Daemon Service Mode (token missing)'
      : desiredState === 'stopped'
        ? Date.now() < persisted.manualStopUntilMs
          ? 'Miya Daemon Manual Cooldown'
          : 'Miya Daemon Stopped'
        : persisted.retryHalted
          ? 'Miya Daemon Retry Halted'
          : 'Miya Daemon Booting';
  const runtime: LauncherRuntime = {
    projectDir,
    lifecycleMode,
    daemonToken,
    desiredState,
    lifecycleState: initialLifecycleState,
    runEpoch: Math.max(1, persisted.runEpoch),
    parentLockFile: path.join(daemonDir(projectDir), 'parent.lock.json'),
    daemonLockFile: path.join(daemonDir(projectDir), 'daemon.lock.json'),
    runtimeStoreFile: daemonLauncherStoreFile(projectDir),
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
    manualStopUntilMs: persisted.manualStopUntilMs,
    manualStopCooldownMs: Math.max(
      10_000,
      Math.floor(configuredManualStopCooldown),
    ),
    consecutiveLaunchFailures: persisted.consecutiveLaunchFailures,
    retryHalted: persisted.retryHalted,
    retryHaltedUntilMs: persisted.retryHaltedUntilMs,
    retryHaltCooldownMs: Math.max(
      30_000,
      Math.floor(configuredRetryHaltCooldown),
    ),
    maxConsecutiveLaunchFailures: Math.max(
      1,
      Math.floor(configuredMaxFailures),
    ),
    lastAccessAtMs: Date.now(),
    snapshot: {
      connected: false,
      statusText: initialStatusText,
      desiredState,
      lifecycleState: initialLifecycleState,
      runEpoch: Math.max(1, persisted.runEpoch),
      retryHalted: persisted.retryHalted,
      retryHaltedUntil:
        persisted.retryHaltedUntilMs > 0
          ? new Date(persisted.retryHaltedUntilMs).toISOString()
          : undefined,
      manualStopUntil:
        persisted.manualStopUntilMs > 0
          ? new Date(persisted.manualStopUntilMs).toISOString()
          : undefined,
      lifecycleMode,
      pendingRequests: 0,
      rejectedRequests: 0,
      startedAt: nowIso(),
    },
  };
  syncLifecycleSnapshot(runtime);
  syncBackpressureSnapshot(runtime);
  runtimes.set(projectDir, runtime);
  writeLauncherPersistedState(runtime);

  writeParentLock(runtime);
  runtime.parentBeatTimer = safeInterval('launcher.parent.beat', 10_000, () => {
    writeParentLock(runtime);
  });
  const epoch =
    runtime.desiredState === 'running'
      ? requestRunningState(runtime)
      : runtime.runEpoch;
  ensureDaemonLaunched(runtime, epoch);
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
      desiredState: 'stopped',
      lifecycleState: 'STOPPED',
      runEpoch: 0,
      retryHalted: false,
      pendingRequests: 0,
      rejectedRequests: 0,
      startedAt: nowIso(),
    };
  }
  touchRuntime(runtime);
  syncLifecycleSnapshot(runtime);
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
  touchRuntime(runtime);
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
  if (!runtime) {
    const persisted = readLauncherPersistedState(projectDir);
    const manualStopCooldownMs = Math.max(
      10_000,
      Math.floor(
        Number(process.env.MIYA_DAEMON_MANUAL_STOP_COOLDOWN_MS ?? 180_000),
      ),
    );
    safeWriteJson(daemonLauncherStoreFile(projectDir), {
      ...persisted,
      desiredState: 'stopped',
      runEpoch: Math.max(1, persisted.runEpoch) + 1,
      manualStopUntilMs: Date.now() + manualStopCooldownMs,
      updatedAt: nowIso(),
    });
    return;
  }
  touchRuntime(runtime);
  runtime.desiredState = 'stopped';
  runtime.runEpoch += 1;
  runtime.manualStopUntilMs = Date.now() + runtime.manualStopCooldownMs;
  runtime.connected = false;
  runtime.snapshot.connected = false;
  setLifecycleState(runtime, 'STOPPING', 'Miya Daemon Stopping');
  writeLauncherPersistedState(runtime);
  cleanupRuntime(runtime);
  if (runtime.lifecycleMode !== 'service_experimental') {
    cleanupExistingDaemon(projectDir);
  }
  try {
    fs.rmSync(runtime.parentLockFile, { force: true });
  } catch {}
  writeLauncherPersistedState(runtime);
  runtimes.delete(projectDir);
}

export function subscribeLauncherEvents(
  projectDir: string,
  listener: DaemonLauncherListener,
): () => void {
  ensureMiyaLauncher(projectDir);
  const runtime = runtimes.get(projectDir);
  if (!runtime) return () => {};
  touchRuntime(runtime);
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
  const epoch = requestRunningState(runtime, { explicit: true });
  if (runtime.ws?.readyState === WebSocket.OPEN && runtime.connected) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    ensureDaemonLaunched(runtime, epoch);
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
  touchRuntime(runtime);
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
