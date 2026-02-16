import { describe, expect, test } from 'bun:test';
import { ensureGatewayRunning, stopGateway } from './index';
import { createGatewayAcceptanceProjectDir } from './test-helpers';
import { getLauncherDaemonSnapshot } from '../daemon';

interface GatewayWsClient {
  request(
    method: string,
    params?: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ): Promise<unknown>;
  close(): void;
}

async function connectGateway(
  url: string,
  token?: string,
): Promise<GatewayWsClient> {
  return connectGatewayWithRole(url, token, 'admin');
}

async function connectGatewayWithRole(
  url: string,
  token: string | undefined,
  role: 'ui' | 'admin' | 'node' | 'channel' | 'unknown',
): Promise<GatewayWsClient> {
  const wsUrl = `${url.replace('http://', 'ws://')}/ws`;
  const ws = new WebSocket(wsUrl);
  let requestID = 0;
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('gateway_ws_hello_timeout')), 10_000);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          role,
          clientID: 'test-client',
          protocolVersion: '1.1',
          auth: token ? { token } : undefined,
        }),
      );
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('gateway_ws_error'));
    };
    ws.onmessage = (event) => {
      let frame: any;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (frame?.type !== 'response') return;
      if (frame.id === 'hello') {
        clearTimeout(timeout);
        if (frame.ok) {
          resolve();
          return;
        }
        reject(new Error(String(frame.error?.message ?? 'gateway_hello_failed')));
        return;
      }
      const waiter = pending.get(String(frame.id));
      if (!waiter) return;
      pending.delete(String(frame.id));
      clearTimeout(waiter.timer);
      if (frame.ok) {
        waiter.resolve(frame.result);
      } else {
        waiter.reject(new Error(String(frame.error?.message ?? 'gateway_request_failed')));
      }
    };
  });

  await ready;

  return {
    request(
      method: string,
      params: Record<string, unknown> = {},
      options?: { idempotencyKey?: string },
    ) {
      requestID += 1;
      const id = `req-${requestID}`;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`gateway_request_timeout:${method}`));
        }, 30_000);
        pending.set(id, { resolve, reject, timer });
        ws.send(
          JSON.stringify({
            type: 'request',
            id,
            method,
            params,
            idempotencyKey:
              typeof options?.idempotencyKey === 'string'
                ? options.idempotencyKey
                : id,
          }),
        );
      });
    },
    close() {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('gateway_ws_closed'));
      }
      pending.clear();
      ws.close();
    },
  };
}

async function legacyHelloHandshake(url: string, token?: string): Promise<void> {
  const wsUrl = `${url.replace('http://', 'ws://')}/ws`;
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('legacy_hello_timeout'));
    }, 10_000);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          role: 'ui',
          clientID: 'legacy-client',
          auth: token ? { token } : undefined,
        }),
      );
    };
    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data));
        if (frame?.type === 'response' && frame?.id === 'hello' && frame?.ok) {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch {}
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      ws.close();
      reject(new Error('legacy_hello_error'));
    };
  });
}

describe('gateway milestone acceptance', () => {
  test('runs startup probe for 20 rounds with stable gateway health', { timeout: 30_000 }, async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    ensureGatewayRunning(projectDir);
    try {
      const rounds = 20;
      let gatewayHealthy = 0;
      const samples: Array<{ gatewayAlive: boolean; daemonConnected: boolean }> = [];
      for (let index = 0; index < rounds; index += 1) {
        const snapshot = ensureGatewayRunning(projectDir);
        const gatewayAlive = snapshot.status === 'running' && snapshot.port > 0;
        const daemonConnected = Boolean(getLauncherDaemonSnapshot(projectDir).connected);
        if (gatewayAlive) gatewayHealthy += 1;
        samples.push({ gatewayAlive, daemonConnected });
        if (index < rounds - 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      expect(gatewayHealthy).toBe(20);
      expect(samples).toHaveLength(20);
      expect(samples.every((sample) => sample.gatewayAlive)).toBe(true);
    } finally {
      stopGateway(projectDir);
    }
  });

  test('runs 10-concurrency pressure probe with accounted outcomes', { timeout: 30_000 }, async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url, state.authToken);
    try {
      const result = (await client.request('gateway.pressure.run', {
        concurrency: 10,
        rounds: 1,
        timeoutMs: 10_000,
      })) as {
        success: number;
        failed: number;
        gateway: { rejected_timeout: number; rejected_overloaded: number };
      };
      expect(result.success + result.failed).toBe(10);
      expect(result.gateway.rejected_timeout).toBeGreaterThanOrEqual(0);
      expect(result.gateway.rejected_overloaded).toBeGreaterThanOrEqual(0);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('exposes provider override audit and mcp capabilities endpoints', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url, state.authToken);
    try {
      const providerAudit = (await client.request('provider.override.audit.list', {
        limit: 20,
      })) as unknown[];
      const capabilities = (await client.request('mcp.capabilities.list', {})) as {
        mcps?: Array<{ name: string; sampling: boolean; mcpUi: boolean }>;
      };
      expect(Array.isArray(providerAudit)).toBe(true);
      expect(Array.isArray(capabilities.mcps)).toBe(true);
      expect(capabilities.mcps?.every((item) => typeof item.sampling === 'boolean')).toBe(true);
      expect(capabilities.mcps?.every((item) => typeof item.mcpUi === 'boolean')).toBe(true);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('exposes nexus runtime fields for control ui telemetry', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url, state.authToken);
    try {
      const snapshot = (await client.request('gateway.status.get')) as {
        nexus?: {
          sessionId?: string;
          pendingTickets?: number;
          killSwitchMode?: string;
          insights?: Array<{ text?: string }>;
        };
      };
      expect(typeof snapshot.nexus?.sessionId).toBe('string');
      expect(typeof snapshot.nexus?.pendingTickets).toBe('number');
      expect(typeof snapshot.nexus?.killSwitchMode).toBe('string');
      expect(Array.isArray(snapshot.nexus?.insights)).toBe(true);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('deduplicates idempotent RPC submissions', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url, state.authToken);
    try {
      const first = (await client.request(
        'gateway.status.get',
        { probe: 'idempotent' },
        { idempotencyKey: 'dedupe-token-1' },
      )) as { updatedAt?: string };
      const second = (await client.request(
        'gateway.status.get',
        { probe: 'idempotent' },
        { idempotencyKey: 'dedupe-token-1' },
      )) as { updatedAt?: string };
      expect(typeof first.updatedAt).toBe('string');
      expect(second).toEqual(first);

    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('keeps legacy hello handshake compatible when protocolVersion is omitted', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    try {
      await legacyHelloHandshake(state.url, state.authToken);
    } finally {
      stopGateway(projectDir);
    }
  });
});
