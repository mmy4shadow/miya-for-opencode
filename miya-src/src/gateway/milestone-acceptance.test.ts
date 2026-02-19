import { describe, expect, test } from 'bun:test';
import { ensureGatewayRunning, stopGateway } from './index';
import { createGatewayAcceptanceProjectDir } from './test-helpers';

interface GatewayWsClient {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

async function connectGateway(url: string): Promise<GatewayWsClient> {
  return connectGatewayWithRole(url, 'admin');
}

async function connectGatewayWithRole(
  url: string,
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
      ws.send(JSON.stringify({ type: 'hello', role, clientID: 'test-client' }));
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

describe('gateway milestone acceptance', () => {
  test('runs startup probe for 20 rounds with stable gateway health', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
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
    const projectDir = await createGatewayAcceptanceProjectDir();
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
    const projectDir = await createGatewayAcceptanceProjectDir();
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

  test('supports agent runtime model list/set/reset lifecycle', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      const before = (await client.request('agent.runtime.list')) as {
        agents?: Array<{ agentName?: string; model?: string }>;
      };
      expect(Array.isArray(before.agents)).toBe(true);
      expect((before.agents ?? []).length).toBeGreaterThanOrEqual(7);

      const setResult = (await client.request('agent.runtime.set', {
        agentName: '6-ui-designer',
        model: 'google/gemini-2.5-pro',
      })) as {
        changed?: boolean;
        state?: {
          activeAgentId?: string;
          agents?: Array<{ agentName?: string; source?: string; model?: string }>;
        };
      };
      expect(typeof setResult.changed).toBe('boolean');
      expect(setResult.state?.activeAgentId).toBe('6-ui-designer');
      const uiState = (setResult.state?.agents ?? []).find((item) => item.agentName === '6-ui-designer');
      expect(uiState?.model).toBe('google/gemini-2.5-pro');
      expect(uiState?.source).toBe('runtime');

      const resetResult = (await client.request('agent.runtime.reset', {
        agentName: '6-ui-designer',
      })) as {
        changed?: boolean;
        state?: {
          agents?: Array<{ agentName?: string; source?: string; model?: string }>;
        };
      };
      expect(typeof resetResult.changed).toBe('boolean');
      const resetUiState = (resetResult.state?.agents ?? []).find(
        (item) => item.agentName === '6-ui-designer',
      );
      expect(resetUiState?.source).toBe('default');
      expect(typeof resetUiState?.model).toBe('string');
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('exposes nexus runtime fields for control ui telemetry', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
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
});
