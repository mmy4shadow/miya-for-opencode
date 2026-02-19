import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData } from 'ws';

interface BunServeWebsocketHandlers {
  open?: (ws: NodeCompatWebSocket) => void;
  close?: (ws: NodeCompatWebSocket) => void;
  message?: (ws: NodeCompatWebSocket, message: unknown) => void | Promise<void>;
}

interface BunServeOptions {
  hostname?: string;
  port: number;
  fetch: (
    request: Request,
    server: {
      upgrade: (
        request: Request,
        options?: {
          data?: unknown;
        },
      ) => boolean;
    },
  ) => Response | Promise<Response> | void | Promise<void>;
  websocket?: BunServeWebsocketHandlers;
}

interface BunSpawnSyncOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: 'pipe' | 'inherit' | 'ignore';
  stderr?: 'pipe' | 'inherit' | 'ignore';
}

interface BunCompatServer {
  port: number;
  publish: (channel: string, payload: string) => void;
  stop: (force?: boolean) => void;
}

interface BunCompatRuntime {
  __miyaNodeCompat?: boolean;
  which: (bin: string) => string | null;
  serve: (options: BunServeOptions) => BunCompatServer;
  spawnSync: (
    command: string[],
    options?: BunSpawnSyncOptions,
  ) => {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  file: (file: string) => Uint8Array;
}

interface NodeCompatWebSocket {
  send: (payload: string) => void;
  close: () => void;
  subscribe: (channel: string) => void;
}

interface NodeCompatWebSocketInternal extends NodeCompatWebSocket {
  channels: Set<string>;
  raw: import('ws').WebSocket;
}

function createRequestFromRaw(input: {
  url: string;
  method: string;
  headers: Headers;
  body?: Uint8Array;
}): Request {
  const methodUpper = input.method.toUpperCase();
  const init: RequestInit = {
    method: methodUpper,
    headers: input.headers,
  };
  if (
    input.body &&
    methodUpper !== 'GET' &&
    methodUpper !== 'HEAD' &&
    methodUpper !== 'OPTIONS'
  ) {
    init.body = Buffer.from(input.body);
  }
  return new Request(input.url, init);
}

async function readRequestBody(
  req: import('node:http').IncomingMessage,
): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')
    return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

function toNodeStatusText(status: number): string {
  if (status >= 200 && status < 300) return 'OK';
  if (status === 400) return 'Bad Request';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not Found';
  if (status === 410) return 'Gone';
  if (status === 500) return 'Internal Server Error';
  if (status === 503) return 'Service Unavailable';
  return 'Response';
}

async function writeNodeResponse(
  res: import('node:http').ServerResponse,
  response: Response,
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  if (body && !('content-length' in headers)) {
    headers['content-length'] = String(body.length);
  }
  res.writeHead(response.status, headers);
  if (body) {
    res.end(body);
  } else {
    res.end();
  }
}

async function writeUpgradeRejection(
  socket: Duplex,
  response?: Response,
): Promise<void> {
  const fallback = response ?? new Response('websocket upgrade failed', { status: 400 });
  const statusText = toNodeStatusText(fallback.status);
  const body = Buffer.from(await fallback.text());
  const headerLines: string[] = [
    `HTTP/1.1 ${fallback.status} ${statusText}`,
    'Connection: close',
    `Content-Length: ${body.length}`,
  ];
  fallback.headers.forEach((value, key) => {
    headerLines.push(`${key}: ${value}`);
  });
  socket.write(`${headerLines.join('\r\n')}\r\n\r\n`);
  if (body.length > 0) {
    socket.write(body);
  }
  socket.destroy();
}

function createNodeCompatWebSocket(raw: import('ws').WebSocket): NodeCompatWebSocketInternal {
  const channels = new Set<string>();
  return {
    raw,
    channels,
    send(payload: string) {
      if (raw.readyState === raw.OPEN) {
        raw.send(payload);
      }
    },
    close() {
      raw.close();
    },
    subscribe(channel: string) {
      channels.add(channel);
    },
  };
}

function normalizeWebSocketMessage(data: RawData, isBinary: boolean): unknown {
  if (!isBinary) {
    return data.toString();
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf-8');
  }
  return String(data);
}

function createBunServeCompat(options: BunServeOptions): BunCompatServer {
  const host = options.hostname ?? '127.0.0.1';
  const requestedPort = Number(options.port ?? 0);
  let activePort = requestedPort;
  const sockets = new Set<NodeCompatWebSocketInternal>();
  const rawToCompat = new WeakMap<import('ws').WebSocket, NodeCompatWebSocketInternal>();
  const pendingUpgradeData = new WeakMap<Request, unknown>();

  const wss = new WebSocketServer({ noServer: true });
  const server = createServer(async (req, res) => {
    const hostHeader = String(req.headers.host ?? `${host}:${activePort}`);
    const url = new URL(req.url ?? '/', `http://${hostHeader}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (typeof value === 'string') {
        headers.set(key, value);
      }
    }
    const body = await readRequestBody(req);
    const request = createRequestFromRaw({
      url: url.toString(),
      method: req.method ?? 'GET',
      headers,
      body,
    });
    const upgrade = () => false;
    const response = await options.fetch(request, { upgrade });
    if (response instanceof Response) {
      await writeNodeResponse(res, response);
      return;
    }
    res.writeHead(204);
    res.end();
  });

  server.on('upgrade', async (req, socket, head) => {
    const hostHeader = String(req.headers.host ?? `${host}:${activePort}`);
    const url = new URL(req.url ?? '/', `http://${hostHeader}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (typeof value === 'string') {
        headers.set(key, value);
      }
    }
    const request = createRequestFromRaw({
      url: url.toString(),
      method: req.method ?? 'GET',
      headers,
    });
    let upgradeRequested = false;
    const response = await options.fetch(request, {
      upgrade(candidate, upgradeOptions) {
        if (candidate !== request) return false;
        upgradeRequested = true;
        pendingUpgradeData.set(request, upgradeOptions?.data);
        return true;
      },
    });
    if (!upgradeRequested) {
      await writeUpgradeRejection(socket, response instanceof Response ? response : undefined);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: import('ws').WebSocket) => {
      const compat = createNodeCompatWebSocket(ws);
      sockets.add(compat);
      rawToCompat.set(ws, compat);
      const data = pendingUpgradeData.get(request);
      pendingUpgradeData.delete(request);
      if (data !== undefined) {
        Object.assign(compat as unknown as Record<string, unknown>, { data });
      }
      options.websocket?.open?.(compat);
      ws.on('message', (payload: RawData, isBinary: boolean) => {
        const message = normalizeWebSocketMessage(payload, isBinary);
        void options.websocket?.message?.(compat, message);
      });
      ws.on('close', () => {
        sockets.delete(compat);
        rawToCompat.delete(ws);
        options.websocket?.close?.(compat);
      });
    });
  });

  server.listen(requestedPort, host);
  const addr = server.address();
  if (addr && typeof addr === 'object') {
    activePort = (addr as AddressInfo).port;
  }

  return {
    get port() {
      const latest = server.address();
      if (latest && typeof latest === 'object') {
        return (latest as AddressInfo).port;
      }
      return activePort;
    },
    publish(channel: string, payload: string) {
      for (const ws of sockets) {
        if (!ws.channels.has(channel)) continue;
        ws.send(payload);
      }
    },
    stop(force = false) {
      for (const ws of sockets) {
        try {
          if (force) {
            ws.raw.terminate();
          } else {
            ws.close();
          }
        } catch {}
      }
      try {
        wss.close();
      } catch {}
      try {
        server.close();
      } catch {}
    },
  };
}

function createBunSpawnSyncCompat(
  command: string[],
  options: BunSpawnSyncOptions = {},
): { exitCode: number; stdout: Uint8Array; stderr: Uint8Array } {
  const [bin, ...args] = command;
  if (!bin) {
    return {
      exitCode: 1,
      stdout: new Uint8Array(),
      stderr: Buffer.from('spawn_missing_binary', 'utf-8'),
    };
  }
  const stdoutMode = options.stdout ?? 'pipe';
  const stderrMode = options.stderr ?? 'pipe';
  const proc = nodeSpawnSync(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', stdoutMode, stderrMode],
    windowsHide: true,
  });
  return {
    exitCode: proc.status ?? (proc.error ? 1 : 0),
    stdout: proc.stdout ? Buffer.from(proc.stdout) : new Uint8Array(),
    stderr: proc.stderr ? Buffer.from(proc.stderr) : new Uint8Array(),
  };
}

function createBunWhichCompat(bin: string): string | null {
  const target = String(bin ?? '').trim();
  if (!target) return null;
  const pathValue = String(process.env.PATH ?? '');
  const pathExtRaw = String(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM');
  const pathExt = pathExtRaw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  const hasExt = /\.[a-z0-9]+$/i.test(target);
  const candidates: string[] = [];
  for (const base of pathValue.split(path.delimiter)) {
    const dir = base.trim();
    if (!dir) continue;
    const joined = path.join(dir, target);
    candidates.push(joined);
    if (process.platform === 'win32' && !hasExt) {
      for (const ext of pathExt) {
        candidates.push(joined + ext.toLowerCase());
        candidates.push(joined + ext.toUpperCase());
      }
    }
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

function createBunFileCompat(file: string | URL): Uint8Array {
  return fs.readFileSync(file);
}

export function ensureBunNodeCompat(): void {
  const runtime = globalThis as Record<string, unknown>;
  const existing = runtime.Bun as BunCompatRuntime | undefined;
  if (existing?.__miyaNodeCompat) return;
  if (existing && typeof existing === 'object') {
    // Some runtimes expose Bun with readonly descriptors. Mutating it can throw and
    // crash gateway worker startup, so keep the existing object untouched.
    return;
  }
  const compat: BunCompatRuntime = {
    __miyaNodeCompat: true,
    which: createBunWhichCompat,
    serve: createBunServeCompat,
    spawnSync: createBunSpawnSyncCompat,
    file: createBunFileCompat,
  };
  const merged = { ...compat } as BunCompatRuntime;
  try {
    Object.defineProperty(globalThis, 'Bun', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: merged,
    });
  } catch {
    // Last resort for locked globals: keep a reachable compat object.
    (runtime as Record<string, unknown>).__miyaBunCompat = merged;
  }
}
