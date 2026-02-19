interface GatewayRpcClientOptions {
  wsPath: string;
  httpRpcPath?: string;
  tokenProvider: () => string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface GatewayResponseFrame {
  type?: string;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: {
    message?: string;
  };
}

interface PendingGatewayRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function buildWsCandidates(wsPath: string): string[] {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const normalizedPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  const candidatePaths = [normalizedPath];
  if (normalizedPath !== '/ws' && normalizedPath.endsWith('/ws')) {
    candidatePaths.push('/ws');
  }
  const candidates: string[] = [];
  for (const candidatePath of candidatePaths) {
    candidates.push(`${proto}://${location.host}${candidatePath}`);
  }
  if (!isLoopbackHost(location.hostname)) {
    return [...new Set(candidates)];
  }
  const fallbackHosts = ['127.0.0.1', 'localhost', '[::1]'];
  for (const candidatePath of candidatePaths) {
    for (const host of fallbackHosts) {
      const withPort = location.port ? `${host}:${location.port}` : host;
      candidates.push(`${proto}://${withPort}${candidatePath}`);
    }
  }
  return [...new Set(candidates)];
}

export class GatewayRpcClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingGatewayRequest>();
  private openPromise: Promise<void> | null = null;
  private seq = 0;
  private activeUrl = '';
  private connectEpoch = 0;
  private readonly options: {
    wsPath: string;
    httpRpcPath: string;
    tokenProvider: () => string;
    connectTimeoutMs: number;
    requestTimeoutMs: number;
  };

  constructor(options: GatewayRpcClientOptions) {
    this.options = {
      wsPath: options.wsPath,
      httpRpcPath: options.httpRpcPath ?? '/api/rpc',
      tokenProvider: options.tokenProvider,
      connectTimeoutMs: Math.max(2000, options.connectTimeoutMs ?? 5000),
      requestTimeoutMs: Math.max(2000, options.requestTimeoutMs ?? 10000),
    };
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    try {
      await this.ensureConnected();
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('gateway_ws_not_connected');
      }
      const requestId = `ui-${Date.now()}-${++this.seq}`;
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error(`gateway_request_timeout:${method}`));
        }, this.options.requestTimeoutMs);
        this.pending.set(requestId, { resolve, reject, timer });
        try {
          this.ws?.send(
            JSON.stringify({
              type: 'request',
              id: requestId,
              method,
              params,
            }),
          );
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(
            new Error(
              error instanceof Error
                ? error.message
                : 'gateway_ws_send_request_failed',
            ),
          );
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (this.shouldFallbackToHttp(message)) {
        return await this.requestViaHttp(method, params);
      }
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private shouldFallbackToHttp(message: string): boolean {
    const text = String(message ?? '').toLowerCase();
    if (text.includes('invalid_gateway_token')) return false;
    return (
      text.includes('gateway_ws_') ||
      text.includes('gateway_request_timeout') ||
      text.includes('failed to fetch') ||
      text.includes('networkerror')
    );
  }

  private async requestViaHttp(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const token = this.options.tokenProvider();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    if (token) {
      headers['x-miya-gateway-token'] = token;
    }
    const response = await fetch(this.options.httpRpcPath, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method,
        params,
      }),
      cache: 'no-store',
    });
    let payload: {
      ok?: boolean;
      result?: unknown;
      error?: string;
    } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {}
    if (!response.ok || !payload.ok) {
      const message =
        payload.error ||
        `gateway_http_rpc_failed:${response.status}:${response.statusText}`;
      throw new Error(message);
    }
    return payload.result;
  }

  dispose(): void {
    this.connectEpoch += 1;
    this.rejectPending('gateway_ws_disposed');
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
    this.openPromise = null;
    this.activeUrl = '';
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.openPromise) {
      await this.openPromise;
      return;
    }
    const epoch = this.connectEpoch;
    this.openPromise = this.connectWithFallback(epoch);
    try {
      await this.openPromise;
    } finally {
      this.openPromise = null;
    }
  }

  private async connectWithFallback(epoch: number): Promise<void> {
    const errors: string[] = [];
    for (const candidate of buildWsCandidates(this.options.wsPath)) {
      if (epoch !== this.connectEpoch) {
        throw new Error('gateway_ws_connect_cancelled');
      }
      try {
        await this.connectOne(candidate, epoch);
        this.activeUrl = candidate;
        return;
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : String(error ?? ''),
        );
      }
    }
    throw new Error(
      `gateway_ws_connect_failed:${errors.filter(Boolean).join(' | ')}`,
    );
  }

  private async connectOne(url: string, epoch: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;

      const done = (ok: boolean, reason?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) {
          if (epoch !== this.connectEpoch) {
            try {
              ws.close();
            } catch {}
            reject(new Error('gateway_ws_connect_cancelled'));
            return;
          }
          this.bindSocket(ws);
          resolve();
          return;
        }
        try {
          ws.close();
        } catch {}
        reject(new Error(reason || `gateway_ws_connect_failed:${url}`));
      };

      const timer = setTimeout(() => {
        done(false, `gateway_ws_connect_timeout:${url}`);
      }, this.options.connectTimeoutMs);

      ws.onopen = () => {
        const token = this.options.tokenProvider();
        ws.send(
          JSON.stringify({
            type: 'hello',
            role: 'ui',
            clientID: 'gateway-ui',
            protocolVersion: '1.1',
            auth: token ? { token } : undefined,
          }),
        );
      };

      ws.onmessage = (event) => {
        if (settled) return;
        let frame: GatewayResponseFrame;
        try {
          frame = JSON.parse(String(event.data)) as GatewayResponseFrame;
        } catch {
          return;
        }
        if (frame.type !== 'response' || frame.id !== 'hello') return;
        if (frame.ok) {
          done(true);
        } else {
          const message = frame.error?.message || `gateway_ws_hello_failed:${url}`;
          done(false, message);
        }
      };

      ws.onerror = () => {
        done(false, `gateway_ws_error:${url}`);
      };

      ws.onclose = () => {
        if (!settled) {
          done(false, `gateway_ws_closed_before_ready:${url}`);
        }
      };
    });
  }

  private bindSocket(ws: WebSocket): void {
    this.ws = ws;
    ws.onmessage = (event) => {
      let frame: GatewayResponseFrame;
      try {
        frame = JSON.parse(String(event.data)) as GatewayResponseFrame;
      } catch {
        return;
      }
      if (frame.type !== 'response' || !frame.id) return;
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      if (frame.ok) {
        pending.resolve(frame.result);
      } else {
        pending.reject(
          new Error(frame.error?.message || 'gateway_request_failed'),
        );
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.activeUrl = '';
      }
      this.rejectPending('gateway_ws_closed');
    };
    ws.onerror = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.activeUrl = '';
      }
      this.rejectPending('gateway_ws_error');
    };
  }

  private rejectPending(reason: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(
          this.activeUrl ? `${reason}:${this.activeUrl}:${id}` : `${reason}:${id}`,
        ),
      );
      this.pending.delete(id);
    }
  }
}
