import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getMiyaRuntimeDir } from '../workflow';
import { readConfig, validateConfigPatch, applyConfigPatch } from '../settings';
import { assertPolicyHash, currentPolicyHash } from '../policy';
import {
  parseDaemonIncomingFrame,
  DaemonResponseFrameSchema,
  DaemonEventFrameSchema,
  DaemonPongFrameSchema,
} from './ws-protocol';

interface HostArgs {
  projectDir: string;
  parentLockFile: string;
  token: string;
}

interface CpuSample {
  idle: number;
  total: number;
}

function parseArgs(argv: string[]): HostArgs {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, 'true');
    } else {
      args.set(key, next);
      i += 1;
    }
  }

  const projectDir = args.get('project-dir');
  const parentLockFile = args.get('parent-lock-file');
  const token = args.get('token');
  if (!projectDir || !parentLockFile || !token) {
    throw new Error('missing_required_args');
  }
  return { projectDir, parentLockFile, token };
}

function daemonDir(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'daemon');
}

function daemonLockFile(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'daemon.lock.json');
}

function ensureRuntimeDir(projectDir: string): void {
  fs.mkdirSync(daemonDir(projectDir), { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function collectCpuSample(): CpuSample {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

function gpuMemoryTelemetry(): { usedMB?: number; totalMB?: number } {
  try {
    const probe = spawnSync(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8', timeout: 1500 },
    );
    if (probe.status !== 0) return {};
    const line = String(probe.stdout || '').trim().split(/\r?\n/)[0];
    if (!line) return {};
    const [usedRaw, totalRaw] = line.split(',').map((item) => Number(item.trim()));
    if (!Number.isFinite(usedRaw) || !Number.isFinite(totalRaw)) return {};
    return { usedMB: usedRaw, totalMB: totalRaw };
  } catch {
    return {};
  }
}

function stableHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

const args = parseArgs(process.argv);
ensureRuntimeDir(args.projectDir);

let wsConnected = false;
let wsClientID = '';
let startedAtMs = Date.now();
let lastSeenMs = Date.now();
let cpuPercent = 0;
let cpuPrev = collectCpuSample();
let missingParentSince: number | null = null;

const telemetryTimer = setInterval(() => {
  const next = collectCpuSample();
  const idleDelta = next.idle - cpuPrev.idle;
  const totalDelta = next.total - cpuPrev.total;
  cpuPrev = next;
  if (totalDelta > 0) {
    cpuPercent = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
  }
}, 2_000);

function baseStatus(): Record<string, unknown> {
  const gpu = gpuMemoryTelemetry();
  return {
    pid: process.pid,
    connected: wsConnected,
    clientID: wsClientID || undefined,
    uptimeSec: Math.floor((Date.now() - startedAtMs) / 1000),
    cpuPercent: Number(cpuPercent.toFixed(2)),
    vramUsedMB: gpu.usedMB,
    vramTotalMB: gpu.totalMB,
    lastSeenAt: new Date(lastSeenMs).toISOString(),
    policyHash: currentPolicyHash(args.projectDir),
  };
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request, instance) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token');
      if (token !== args.token) {
        return new Response('unauthorized', { status: 401 });
      }
      const upgraded = instance.upgrade(request);
      if (upgraded) return;
      return new Response('upgrade_failed', { status: 400 });
    }
    if (url.pathname === '/health') {
      return Response.json(baseStatus(), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    open() {
      wsConnected = true;
      lastSeenMs = Date.now();
    },
    close() {
      wsConnected = false;
      wsClientID = '';
    },
    message(ws, input) {
      const parsed = parseDaemonIncomingFrame(input);
      if (!parsed.frame) {
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: 'invalid',
              ok: false,
              error: {
                code: 'bad_request',
                message: parsed.error ?? 'invalid_frame',
              },
            }),
          ),
        );
        return;
      }
      const frame = parsed.frame;
      lastSeenMs = Date.now();

      if (frame.type === 'ping') {
        ws.send(JSON.stringify(DaemonPongFrameSchema.parse({ type: 'pong', ts: frame.ts })));
        return;
      }

      if (frame.type === 'hello') {
        wsClientID = frame.clientID ?? '';
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: 'hello',
              ok: true,
              result: {
                daemonID: `miya-daemon-${process.pid}`,
                protocolVersion: frame.protocolVersion,
              },
            }),
          ),
        );
        ws.send(
          JSON.stringify(
            DaemonEventFrameSchema.parse({
              type: 'event',
              event: 'daemon.ready',
              payload: baseStatus(),
            }),
          ),
        );
        return;
      }

      const params = frame.params ?? {};
      if (frame.method === 'daemon.status.get') {
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: frame.id,
              ok: true,
              result: baseStatus(),
            }),
          ),
        );
        return;
      }

      if (frame.method === 'config.center.get') {
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: frame.id,
              ok: true,
              result: readConfig(args.projectDir),
            }),
          ),
        );
        return;
      }

      if (frame.method === 'config.center.patch') {
        const policyHash = typeof params.policyHash === 'string' ? params.policyHash : undefined;
        const guard = assertPolicyHash(args.projectDir, policyHash);
        if (!guard.ok) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: guard.reason,
                  message: `policy_hash_check_failed:${guard.hash}`,
                },
              }),
            ),
          );
          return;
        }
        const validation = validateConfigPatch(args.projectDir, params.patch);
        if (!validation.ok) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'config_validation_failed',
                  message: stableHash(validation.errors),
                  details: validation,
                },
              }),
            ),
          );
          return;
        }
        const applied = applyConfigPatch(args.projectDir, validation);
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: frame.id,
              ok: true,
              result: applied.updatedConfig,
            }),
          ),
        );
        return;
      }

      ws.send(
        JSON.stringify(
          DaemonResponseFrameSchema.parse({
            type: 'response',
            id: frame.id,
            ok: false,
            error: {
              code: 'unknown_method',
              message: frame.method,
            },
          }),
        ),
      );
    },
  },
});

const lockPayload = {
  pid: process.pid,
  token: args.token,
  wsPort: Number(server.port),
  startedAt: nowIso(),
  updatedAt: nowIso(),
};
writeJson(daemonLockFile(args.projectDir), lockPayload);

const lockTimer = setInterval(() => {
  writeJson(daemonLockFile(args.projectDir), {
    ...lockPayload,
    updatedAt: nowIso(),
    wsConnected,
  });
}, 10_000);

const parentWatchTimer = setInterval(() => {
  const lock = readJsonObject(args.parentLockFile);
  const updatedAt = lock?.updatedAt;
  const parsed = typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN;
  const lockHealthy = Boolean(lock) && Number.isFinite(parsed) && Date.now() - parsed < 30_000;

  if (lockHealthy) {
    missingParentSince = null;
    return;
  }

  if (missingParentSince === null) {
    missingParentSince = Date.now();
    return;
  }
  if (Date.now() - missingParentSince >= 60_000) {
    shutdown(0);
  }
}, 5_000);

function shutdown(code: number): void {
  clearInterval(lockTimer);
  clearInterval(parentWatchTimer);
  clearInterval(telemetryTimer);
  try {
    server.stop(true);
  } catch {}
  try {
    fs.rmSync(daemonLockFile(args.projectDir), { force: true });
  } catch {}
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  try {
    fs.rmSync(daemonLockFile(args.projectDir), { force: true });
  } catch {}
});

if (process.send) {
  process.send({ type: 'miya-daemon-started', port: Number(server.port), pid: process.pid });
}
