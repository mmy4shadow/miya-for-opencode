import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer, type RawData as WsRawData } from 'ws';
import { getMiyaRuntimeDir } from '../workflow';
import { readConfig, validateConfigPatch, applyConfigPatch } from '../settings';
import { assertPolicyHash, currentPolicyHash } from '../policy';
import { MiyaDaemonService } from './service';
import type { ResourceTaskKind } from '../resource-scheduler';
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

function daemonPidFile(projectDir: string): string {
  return path.join(daemonDir(projectDir), 'daemon.pid');
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

function normalizeWsInput(message: WsRawData): string {
  if (typeof message === 'string') return message;
  if (Buffer.isBuffer(message)) return message.toString('utf-8');
  if (Array.isArray(message)) return Buffer.concat(message).toString('utf-8');
  return Buffer.from(message).toString('utf-8');
}

function reservePort(hostname: string, configuredPort: number): number {
  if (configuredPort > 0) return configuredPort;
  const script = [
    "const net=require('node:net');",
    'const host=process.argv[1]||"127.0.0.1";',
    'const s=net.createServer();',
    's.listen(0,host,()=>{',
    'const address=s.address();',
    "if(address&&typeof address==='object'){process.stdout.write(String(address.port));}",
    's.close(()=>process.exit(0));',
    '});',
    "s.on('error',()=>process.exit(1));",
  ].join('');
  const probe = spawnSync('node', ['-e', script, hostname], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (probe.status !== 0) {
    throw new Error(`daemon_port_reservation_failed:${String(probe.stderr || '').trim()}`);
  }
  const parsed = Number(String(probe.stdout || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('daemon_port_reservation_invalid');
  }
  return Math.floor(parsed);
}

function toNodeRequest(
  req: IncomingMessage,
  hostname: string,
  port: number,
): Request {
  const hostHeader =
    typeof req.headers?.host === 'string' && req.headers.host.trim()
      ? req.headers.host.trim()
      : `${hostname}:${port}`;
  const requestUrl = new URL(req.url || '/', `http://${hostHeader}`);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      headers[key] = value.join(', ');
    }
  }
  return new Request(requestUrl, {
    method: req.method ?? 'GET',
    headers,
  });
}

async function writeNodeResponse(
  res: ServerResponse,
  response: Response,
  method: string,
): Promise<void> {
  res.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    res.setHeader(key, value);
  }
  if (method.toUpperCase() === 'HEAD') {
    res.end();
    return;
  }
  if (!response.body) {
    res.end();
    return;
  }
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

function writeUpgradeResponse(socket: Duplex, response: Response): void {
  const statusText = response.statusText || 'OK';
  const lines = [`HTTP/1.1 ${response.status} ${statusText}`];
  for (const [key, value] of response.headers.entries()) {
    lines.push(`${key}: ${value}`);
  }
  void response
    .arrayBuffer()
    .then((bodyBuffer) => {
      const body = Buffer.from(bodyBuffer);
      lines.push(`content-length: ${body.byteLength}`);
      lines.push('', '');
      socket.write(lines.join('\r\n'));
      if (body.byteLength > 0) {
        socket.write(body);
      }
      socket.destroy();
    })
    .catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
}

interface NodeServeOptions {
  hostname: string;
  port: number;
  fetch: (
    request: Request,
    currentServer: {
      upgrade: (request: Request) => boolean;
    },
  ) => Response | void | Promise<Response | void>;
  websocket: {
    open: (ws: WebSocket) => void;
    close: (ws: WebSocket) => void;
    message: (ws: WebSocket, input: WsRawData) => void | Promise<void>;
  };
}

function serveWithNode(options: NodeServeOptions): {
  port: number;
  stop: (_force?: boolean) => void;
} {
  const port = reservePort(options.hostname, options.port);
  const wsServer = new WebSocketServer({ noServer: true });
  const httpServer = createServer((req, res) => {
    void (async () => {
      const request = toNodeRequest(req, options.hostname, port);
      const response =
        (await options.fetch(request, { upgrade: () => false })) ??
        new Response('Not Found', { status: 404 });
      await writeNodeResponse(res, response, req.method ?? 'GET');
    })().catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
      }
      if (!res.writableEnded) {
        res.end('Internal Server Error');
      }
    });
  });

  wsServer.on('connection', (ws) => {
    options.websocket.open(ws);
    ws.on('close', () => options.websocket.close(ws));
    ws.on('message', (input) => {
      void options.websocket.message(ws, input);
    });
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const request = toNodeRequest(req, options.hostname, port);
    let upgraded = false;
    const currentServer = {
      upgrade: () => {
        if (upgraded) return false;
        upgraded = true;
        wsServer.handleUpgrade(req, socket, head, (ws) => {
          wsServer.emit('connection', ws, req);
        });
        return true;
      },
    };
    void Promise.resolve(options.fetch(request, currentServer))
      .then((response) => {
        if (upgraded) return;
        writeUpgradeResponse(socket, response ?? new Response('upgrade_failed', { status: 400 }));
      })
      .catch(() => {
        if (!upgraded) {
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          socket.destroy();
        }
      });
  });

  httpServer.listen(port, options.hostname);

  return {
    port,
    stop() {
      for (const client of wsServer.clients) {
        try {
          client.close();
        } catch {}
      }
      wsServer.close();
      httpServer.close();
    },
  };
}

const args = parseArgs(process.argv);
ensureRuntimeDir(args.projectDir);
const sockets = new Set<WebSocket>();
const daemonService = new MiyaDaemonService(args.projectDir, {
  onProgress: (event) => {
    const payload = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    const frame = DaemonEventFrameSchema.parse({
      type: 'event',
      event: 'job.progress',
      payload,
    });
    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(frame));
      } catch {}
    }
  },
});
daemonService.start();

let wsConnected = false;
let wsClientID = '';
const startedAtMs = Date.now();
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

const memoryWorkerTimer = setInterval(() => {
  try {
    daemonService.runMemoryWorkerTick();
  } catch {}
}, 20_000);

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

const server = serveWithNode({
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
    open(ws) {
      wsConnected = true;
      lastSeenMs = Date.now();
      sockets.add(ws);
    },
    close(ws) {
      wsConnected = false;
      wsClientID = '';
      sockets.delete(ws);
    },
    async message(ws, input) {
      const parsed = parseDaemonIncomingFrame(normalizeWsInput(input));
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

      if (frame.method === 'daemon.psyche.consult') {
        try {
          const urgencyRaw = String(params.urgency ?? 'medium').trim().toLowerCase();
          const urgency =
            urgencyRaw === 'low' || urgencyRaw === 'high' || urgencyRaw === 'critical'
              ? urgencyRaw
              : 'medium';
          const consult = daemonService.consultPsyche({
            intent: String(params.intent ?? 'unknown_intent'),
            urgency,
            channel: typeof params.channel === 'string' ? params.channel : undefined,
            userInitiated: params.userInitiated !==false,
            allowScreenProbe:
              typeof params.allowScreenProbe === 'boolean'
                ? Boolean(params.allowScreenProbe)
                : undefined,
            signals:
              params.signals && typeof params.signals === 'object' && !Array.isArray(params.signals)
                ? (params.signals as Record<string, unknown>)
                : undefined,
            captureLimitations: Array.isArray(params.captureLimitations)
              ? params.captureLimitations.map(String)
              : undefined,
            trust:
              params.trust && typeof params.trust === 'object' && !Array.isArray(params.trust)
                ? {
                    target:
                      typeof (params.trust as Record<string, unknown>).target === 'string'
                        ? String((params.trust as Record<string, unknown>).target)
                        : undefined,
                    source:
                      typeof (params.trust as Record<string, unknown>).source === 'string'
                        ? String((params.trust as Record<string, unknown>).source)
                        : undefined,
                    action:
                      typeof (params.trust as Record<string, unknown>).action === 'string'
                        ? String((params.trust as Record<string, unknown>).action)
                        : undefined,
                    evidenceConfidence:
                      typeof (params.trust as Record<string, unknown>).evidenceConfidence === 'number'
                        ? Number((params.trust as Record<string, unknown>).evidenceConfidence)
                        : undefined,
                  }
                : undefined,
          });
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result: consult,
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'daemon_psyche_consult_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
        return;
      }

      if (frame.method === 'daemon.psyche.outcome') {
        try {
          const explicitFeedbackRaw = String(params.explicitFeedback ?? 'none').trim().toLowerCase();
          const explicitFeedback =
            explicitFeedbackRaw === 'positive' || explicitFeedbackRaw === 'negative'
              ? explicitFeedbackRaw
              : 'none';
          const outcome = daemonService.registerPsycheOutcome({
            consultAuditID: String(params.consultAuditID ?? ''),
            intent: String(params.intent ?? 'unknown_intent'),
            urgency:
              String(params.urgency ?? 'medium').trim().toLowerCase() === 'low'
                ? 'low'
                : String(params.urgency ?? 'medium').trim().toLowerCase() === 'high'
                  ? 'high'
                  : String(params.urgency ?? 'medium').trim().toLowerCase() === 'critical'
                    ? 'critical'
                    : 'medium',
            channel: typeof params.channel === 'string' ? params.channel : undefined,
            userInitiated: params.userInitiated !==false,
            state:
              params.state === 'FOCUS' ||
              params.state === 'CONSUME' ||
              params.state === 'PLAY' ||
              params.state === 'AWAY' ||
              params.state === 'UNKNOWN'
                ? params.state
                : 'UNKNOWN',
            delivered: params.delivered === true,
            blockedReason: typeof params.blockedReason === 'string' ? params.blockedReason : undefined,
            explicitFeedback,
            userReplyWithinSec:
              typeof params.userReplyWithinSec === 'number' && Number.isFinite(params.userReplyWithinSec)
                ? params.userReplyWithinSec
                : undefined,
            userInitiatedWithinSec:
              typeof params.userInitiatedWithinSec === 'number' &&
              Number.isFinite(params.userInitiatedWithinSec)
                ? params.userInitiatedWithinSec
                : undefined,
            trust:
              params.trust && typeof params.trust === 'object' && !Array.isArray(params.trust)
                ? {
                    target:
                      typeof (params.trust as Record<string, unknown>).target === 'string'
                        ? String((params.trust as Record<string, unknown>).target)
                        : undefined,
                    source:
                      typeof (params.trust as Record<string, unknown>).source === 'string'
                        ? String((params.trust as Record<string, unknown>).source)
                        : undefined,
                    action:
                      typeof (params.trust as Record<string, unknown>).action === 'string'
                        ? String((params.trust as Record<string, unknown>).action)
                        : undefined,
                    evidenceConfidence:
                      typeof (params.trust as Record<string, unknown>).evidenceConfidence === 'number'
                        ? Number((params.trust as Record<string, unknown>).evidenceConfidence)
                        : undefined,
                    highRiskRollback:
                      (params.trust as Record<string, unknown>).highRiskRollback === true,
                  }
                : undefined,
          });
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result: outcome,
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'daemon_psyche_outcome_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
        return;
      }

      if (frame.method === 'daemon.python.env.get') {
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: frame.id,
              ok: true,
              result: daemonService.getPythonRuntimeStatus(),
            }),
          ),
        );
        return;
      }

      if (frame.method === 'daemon.model.locks.get') {
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: frame.id,
              ok: true,
              result: daemonService.getModelLockStatus(),
            }),
          ),
        );
        return;
      }

      if (frame.method === 'daemon.model.update.plan') {
        const target =
          typeof params.target === 'string' && params.target.trim()
            ? params.target.trim()
            : undefined;
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: frame.id,
              ok: true,
              result: daemonService.getModelUpdatePlan(target),
            }),
          ),
        );
        return;
      }

      if (frame.method === 'daemon.model.update.apply') {
        try {
          const target =
            typeof params.target === 'string' && params.target.trim()
              ? params.target.trim()
              : undefined;
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result: daemonService.applyModelUpdate(target),
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'daemon_model_update_apply_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
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

      if (frame.method === 'daemon.flux.generate') {
        try {
          const result = await daemonService.runFluxImageGenerate({
            prompt: String(params.prompt ?? ''),
            outputPath: String(params.outputPath ?? ''),
            profileDir: String(params.profileDir ?? ''),
            references: Array.isArray(params.references) ? params.references.map(String) : [],
            size: String(params.size ?? '1024x1024'),
          });
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result,
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'flux_generate_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
        return;
      }

      if (frame.method === 'daemon.sovits.tts') {
        try {
          const fmt = String(params.format ?? 'wav');
          const format = fmt === 'mp3' || fmt === 'ogg' ? fmt : 'wav';
          const result = await daemonService.runSovitsTts({
            text: String(params.text ?? ''),
            outputPath: String(params.outputPath ?? ''),
            profileDir: String(params.profileDir ?? ''),
            voice: String(params.voice ?? 'default'),
            format,
          });
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result,
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'sovits_tts_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
        return;
      }

      if (frame.method === 'daemon.training.flux') {
        try {
          const result = await daemonService.runFluxTraining({
            profileDir: String(params.profileDir ?? ''),
            photosDir: String(params.photosDir ?? ''),
            jobID: String(params.jobID ?? ''),
            checkpointPath:
              typeof params.checkpointPath === 'string' ? params.checkpointPath : undefined,
          });
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result,
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'flux_training_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
        return;
      }

      if (frame.method === 'daemon.training.sovits') {
        try {
          const result = await daemonService.runSovitsTraining({
            profileDir: String(params.profileDir ?? ''),
            voiceSamplePath: String(params.voiceSamplePath ?? ''),
            jobID: String(params.jobID ?? ''),
            checkpointPath:
              typeof params.checkpointPath === 'string' ? params.checkpointPath : undefined,
          });
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result,
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'sovits_training_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
        return;
      }

      if (frame.method === 'daemon.training.cancel') {
        const jobID = String(params.jobID ?? '').trim();
        if (!jobID) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'invalid_job_id',
                  message: 'jobID_required',
                },
              }),
            ),
          );
          return;
        }
        daemonService.requestTrainingCancel(jobID);
        ws.send(
          JSON.stringify(
            DaemonResponseFrameSchema.parse({
              type: 'response',
              id: frame.id,
              ok: true,
              result: { canceled: true, jobID },
            }),
          ),
        );
        return;
      }

      if (frame.method === 'daemon.process.run_isolated') {
        try {
          const requestedKind = String(params.kind ?? 'generic');
          const allowedKinds = new Set<ResourceTaskKind>([
            'generic',
            'training.image',
            'training.voice',
            'image.generate',
            'voice.tts',
            'vision.analyze',
            'shell.exec',
          ]);
          const kind: ResourceTaskKind = allowedKinds.has(requestedKind as ResourceTaskKind)
            ? (requestedKind as ResourceTaskKind)
            : 'generic';
          const rawInput = {
            kind,
            command: String(params.command ?? ''),
            args: Array.isArray(params.args) ? params.args.map(String) : [],
            cwd: typeof params.cwd === 'string' ? params.cwd : undefined,
            env:
              params.env && typeof params.env === 'object' && !Array.isArray(params.env)
                ? (params.env as NodeJS.ProcessEnv)
                : undefined,
            timeoutMs:
              typeof params.timeoutMs === 'number' ? Math.max(1_000, params.timeoutMs) : undefined,
            resource:
              params.resource && typeof params.resource === 'object' && !Array.isArray(params.resource)
                ? (params.resource as {
                    priority?: number;
                    vramMB?: number;
                    modelID?: string;
                    modelVramMB?: number;
                    timeoutMs?: number;
                    metadata?: Record<string, unknown>;
                  })
                : undefined,
            metadata:
              params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
                ? (params.metadata as Record<string, unknown>)
                : undefined,
          };
          if (!rawInput.command) {
            throw new Error('command_required');
          }
          const result = await daemonService.runIsolatedProcess(rawInput);
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: true,
                result,
              }),
            ),
          );
        } catch (error) {
          ws.send(
            JSON.stringify(
              DaemonResponseFrameSchema.parse({
                type: 'response',
                id: frame.id,
                ok: false,
                error: {
                  code: 'isolated_process_failed',
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            ),
          );
        }
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
fs.writeFileSync(daemonPidFile(args.projectDir), `${process.pid}\n`, 'utf-8');

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
  if (Date.now() - missingParentSince >= 30_000) {
    shutdown(0);
  }
}, 5_000);

const heartbeatWatchTimer = setInterval(() => {
  if (!wsConnected) return;
  if (Date.now() - lastSeenMs >= 30_000) {
    shutdown(0);
  }
}, 5_000);

function shutdown(code: number): void {
  daemonService.stop();
  clearInterval(lockTimer);
  clearInterval(parentWatchTimer);
  clearInterval(heartbeatWatchTimer);
  clearInterval(telemetryTimer);
  clearInterval(memoryWorkerTimer);
  try {
    server.stop(true);
  } catch {}
  try {
    fs.rmSync(daemonLockFile(args.projectDir), { force: true });
  } catch {}
  try {
    fs.rmSync(daemonPidFile(args.projectDir), { force: true });
  } catch {}
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  try {
    fs.rmSync(daemonLockFile(args.projectDir), { force: true });
  } catch {}
  try {
    fs.rmSync(daemonPidFile(args.projectDir), { force: true });
  } catch {}
});

if (process.send) {
  process.send({ type: 'miya-daemon-started', port: Number(server.port), pid: process.pid });
}
