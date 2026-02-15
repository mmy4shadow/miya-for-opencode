import { describe, expect, test } from 'bun:test';
import { ensureGatewayRunning, stopGateway } from './index';
import { createGatewayAcceptanceProjectDir } from './test-helpers';

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
      ws.send(JSON.stringify({ type: 'hello', role: 'ui', clientID: 'security-test-client' }));
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

describe('gateway security interaction acceptance', () => {
  test('speaker gate pauses outbound/desktop/memory_read in guest mode', async () => {
    const prevStrict = process.env.MIYA_VOICEPRINT_STRICT;
    process.env.MIYA_VOICEPRINT_STRICT = '0';

    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      await client.request('security.identity.init', {
        password: 'pw-guest',
        passphrase: 'phrase-guest',
      });
      const policy = (await client.request('policy.get')) as { hash: string };

      const thresholdBefore = (await client.request('security.voiceprint.threshold.get')) as {
        ownerMinScore: number;
      };
      expect(thresholdBefore.ownerMinScore).toBeGreaterThan(0.7);

      const thresholdAfter = (await client.request('security.voiceprint.threshold.set', {
        ownerMinScore: 0.81,
        farTarget: 0.02,
      })) as { ownerMinScore: number; farTarget: number };
      expect(thresholdAfter.ownerMinScore).toBe(0.81);
      expect(thresholdAfter.farTarget).toBe(0.02);

      const ingest = (await client.request('voice.input.ingest', {
        policyHash: policy.hash,
        speakerHint: 'guest',
        text: '你好，我只是来聊天。',
        sessionID: 'main',
      })) as {
        mode: string;
        routed: { delivered: boolean };
      };
      expect(ingest.mode).toBe('guest');
      expect(ingest.routed.delivered).toBe(false);

      const domains = (await client.request('policy.domains.list')) as {
        domains: Array<{ domain: string; status: string }>;
      };
      const byName = new Map(domains.domains.map((item) => [item.domain, item.status]));
      expect(byName.get('outbound_send')).toBe('paused');
      expect(byName.get('desktop_control')).toBe('paused');
      expect(byName.get('memory_read')).toBe('paused');
    } finally {
      client.close();
      stopGateway(projectDir);
      if (prevStrict === undefined) {
        delete process.env.MIYA_VOICEPRINT_STRICT;
      } else {
        process.env.MIYA_VOICEPRINT_STRICT = prevStrict;
      }
    }
  });

  test('high-risk outbound requires physical confirmation and password/passphrase', async () => {
    const prevOwnerSyncRequired = process.env.MIYA_OWNER_SYNC_REQUIRED;
    process.env.MIYA_OWNER_SYNC_REQUIRED = '0';

    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      await client.request('security.identity.init', {
        password: 'pw-owner',
        passphrase: 'phrase-owner',
      });
      const policy = (await client.request('policy.get')) as { hash: string };

      const firstTry = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '请批量发送给客户群',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: false,
        },
      })) as {
        sent: boolean;
        message: string;
        requiresConfirmation?: boolean;
      };
      expect(firstTry.sent).toBe(false);
      expect(firstTry.message).toBe('outbound_blocked:high_risk_confirmation_required');
      expect(Boolean(firstTry.requiresConfirmation)).toBe(true);

    } finally {
      client.close();
      stopGateway(projectDir);
      if (prevOwnerSyncRequired === undefined) {
        delete process.env.MIYA_OWNER_SYNC_REQUIRED;
      } else {
        process.env.MIYA_OWNER_SYNC_REQUIRED = prevOwnerSyncRequired;
      }
    }
  });

  test('non-user initiated outbound is deferred by psyche consult guard', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      await client.request('security.identity.init', {
        password: 'pw-owner-psyche',
        passphrase: 'phrase-owner-psyche',
      });
      const policy = (await client.request('policy.get')) as { hash: string };

      const result = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '中午提醒我喝水',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: true,
          userInitiated: false,
        },
      })) as {
        sent: boolean;
        message: string;
        retryAfterSec?: number;
      };
      expect(result.sent).toBe(false);
      expect(result.message).toBe('outbound_blocked:psyche_deferred');
      expect(Number(result.retryAfterSec ?? 0)).toBeGreaterThan(0);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });
});
