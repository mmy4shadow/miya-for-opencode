type GatewayClientOptions = {
  wsPath: string;
  httpRpcPath?: string;
  tokenProvider?: () => string;
  timeoutMs?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type GatewayResponseFrame = {
  type?: string;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
  errorCode?: string;
  errorMessage?: string;
};

type GatewayEventFrame = {
  type?: string;
  event?: string;
  payload?: unknown;
};

function resolveWsUrl(wsPath: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${wsPath}`;
}

export class GatewayRpcClient {
  private readonly wsPath: string;
  private readonly tokenProvider?: () => string;
  private readonly timeoutMs: number;
  private ws: WebSocket | null = null;
  private wsOpenPromise: Promise<void> | null = null;
  private seq = 0;
  private disposed = false;
  private pending = new Map<string, PendingRequest>();

  constructor(options: GatewayClientOptions) {
    this.wsPath = options.wsPath;
    this.tokenProvider = options.tokenProvider;
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 20_000);
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const ws = await this.ensureReadySocket();
    const id = `req-${Date.now()}-${++this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway_request_timeout:${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      ws.send(
        JSON.stringify({
          type: 'request',
          id,
          method,
          params,
        }),
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
    this.wsOpenPromise = null;
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`gateway_client_disposed:${id}`));
    }
    this.pending.clear();
  }

  private async ensureReadySocket(): Promise<WebSocket> {
    if (this.disposed) {
      throw new Error('gateway_client_disposed');
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }
    if (!this.wsOpenPromise) {
      this.wsOpenPromise = this.openSocket();
    }
    await this.wsOpenPromise;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('gateway_ws_not_open');
    }
    return this.ws;
  }

  private async openSocket(): Promise<void> {
    const ws = new WebSocket(resolveWsUrl(this.wsPath));
    this.ws = ws;

    ws.onmessage = (event: MessageEvent<string>) => {
      this.handleMessage(event.data);
    };

    ws.onclose = () => {
      this.rejectAllPending(new Error('gateway_ws_closed'));
      this.ws = null;
      this.wsOpenPromise = null;
    };

    ws.onerror = () => {
      this.rejectAllPending(new Error('gateway_ws_error'));
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('gateway_ws_connect_failed'));
    });

    const hello = await this.sendHello(ws);
    if (!hello.ok) {
      const message = hello.error?.message ?? hello.errorMessage ?? 'gateway_hello_failed';
      try {
        ws.close();
      } catch {}
      throw new Error(message);
    }
  }

  private sendHello(ws: WebSocket): Promise<GatewayResponseFrame> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('gateway_hello_timeout')), this.timeoutMs);
      const handler = (event: MessageEvent<string>) => {
        let frame: GatewayResponseFrame | null = null;
        try {
          frame = JSON.parse(String(event.data)) as GatewayResponseFrame;
        } catch {}
        if (!frame || frame.type !== 'response' || frame.id !== 'hello') {
          return;
        }
        ws.removeEventListener('message', handler);
        clearTimeout(timeout);
        resolve(frame);
      };
      ws.addEventListener('message', handler);
      const token = String(this.tokenProvider?.() ?? '').trim();
      ws.send(
        JSON.stringify({
          type: 'hello',
          id: 'hello',
          role: 'ui',
          auth: token ? { token } : undefined,
        }),
      );
    });
  }

  private handleMessage(raw: string): void {
    let frame: GatewayResponseFrame | GatewayEventFrame | null = null;
    try {
      frame = JSON.parse(raw) as GatewayResponseFrame | GatewayEventFrame;
    } catch {
      return;
    }
    if (!frame || frame.type !== 'response') {
      return;
    }
    const id = typeof frame.id === 'string' ? frame.id : '';
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    if (frame.ok) {
      pending.resolve(frame.result);
      return;
    }
    const message =
      frame.error?.message ??
      frame.errorMessage ??
      frame.error?.code ??
      frame.errorCode ??
      'gateway_request_failed';
    pending.reject(new Error(message));
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

