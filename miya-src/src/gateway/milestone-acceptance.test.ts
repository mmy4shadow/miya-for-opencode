import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureGatewayRunning, stopGateway } from './index';

interface GatewayWsClient {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

async function connectGateway(url: string): Promise<GatewayWsClient> {
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
      ws.send(JSON.stringify({ type: 'hello', role: 'ui', clientID: 'test-client' }));
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
    request(method: string, params: Record<string, unknown> = {}) {
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

function tempProjectDir(): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-gateway-acceptance-'));
  fs.mkdirSync(path.join(projectDir, '.opencode'), { recursive: true });
  return projectDir;
}

describe('gateway milestone acceptance', () => {
  test('runs startup probe for 20 rounds with stable gateway health', async () => {
    const projectDir = tempProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      const result = (await client.request('gateway.startup.probe.run', {
        rounds: 20,
        waitMs: 50,
      })) as {
        rounds: number;
        gatewaySuccessRate: number;
        samples: Array<{ gatewayAlive: boolean }>;
      };
      expect(result.rounds).toBe(20);
      expect(result.gatewaySuccessRate).toBe(100);
      expect(result.samples).toHaveLength(20);
      expect(result.samples.every((sample) => sample.gatewayAlive)).toBe(true);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('runs 10-concurrency pressure probe with accounted outcomes', async () => {
    const projectDir = tempProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
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
    const projectDir = tempProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
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
});
