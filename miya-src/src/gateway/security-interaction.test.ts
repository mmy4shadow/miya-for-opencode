import { describe, expect, test } from 'bun:test';
import { ensureGatewayRunning, stopGateway } from './index';
import { createGatewayAcceptanceProjectDir } from './test-helpers';

interface GatewayWsClient {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

async function connectGateway(
  url: string,
  role: 'ui' | 'admin' | 'node' | 'channel' | 'unknown' = 'admin',
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
      ws.send(JSON.stringify({ type: 'hello', role, clientID: 'security-test-client' }));
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
  test('ui role is stateless and restricted to intervention methods', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url, 'ui');
    try {
      const domains = (await client.request('policy.domains.list')) as {
        domains?: Array<{ domain: string; status: string }>;
      };
      expect(Array.isArray(domains.domains)).toBe(true);
      expect((domains.domains ?? []).length).toBeGreaterThan(0);

      const annotated = (await client.request('intervention.annotate', {
        text: 'manual note',
      })) as { status?: string };
      expect(annotated.status).toBe('recorded');

      const approved = (await client.request('intervention.approve', {
        sessionID: 'main',
        permission: 'external_message',
        patterns: ['*'],
        tier: 'medium',
      })) as {
        status?: string;
        grant?: { permission?: string; sessionID?: string };
      };
      expect(approved.status).toBe('recorded');
      expect(approved.grant?.permission).toBe('external_message');
      expect(approved.grant?.sessionID).toBe('main');
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('supports control-plane killswitch mode switching', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      const switched = (await client.request('killswitch.set_mode', {
        mode: 'outbound_only',
      })) as { mode: string };
      expect(switched.mode).toBe('outbound_only');
      const domains = (await client.request('policy.domains.list')) as {
        domains: Array<{ domain: string; status: string }>;
      };
      const byName = new Map(domains.domains.map((item) => [item.domain, item.status]));
      expect(byName.get('outbound_send')).toBe('paused');
      expect(byName.get('desktop_control')).toBe('running');

      const released = (await client.request('killswitch.set_mode', {
        mode: 'off',
      })) as { mode: string };
      expect(released.mode).toBe('off');
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('blocks domain resume while kill-switch is globally active', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      const switched = (await client.request('killswitch.set_mode', {
        mode: 'all_stop',
      })) as { mode: string };
      expect(switched.mode).toBe('all_stop');

      let blockedError = '';
      try {
        await client.request('policy.domain.resume', { domain: 'outbound_send' });
      } catch (error) {
        blockedError = String(error instanceof Error ? error.message : error);
      }
      expect(blockedError).toBe('kill_switch_active');

      const domains = (await client.request('policy.domains.list')) as {
        domains: Array<{ domain: string; status: string }>;
      };
      const byName = new Map(domains.domains.map((item) => [item.domain, item.status]));
      expect(byName.get('outbound_send')).toBe('paused');

      const released = (await client.request('killswitch.set_mode', {
        mode: 'off',
      })) as { mode: string };
      expect(released.mode).toBe('off');
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('updates trust mode thresholds and exposes them in snapshot', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      const updated = (await client.request('trust.set_mode', {
        silentMin: 95,
        modalMax: 42,
      })) as { mode?: { silentMin?: number; modalMax?: number } };
      expect(updated.mode?.silentMin).toBe(95);
      expect(updated.mode?.modalMax).toBe(42);

      const snapshot = (await client.request('gateway.status.get')) as {
        nexus?: { trustMode?: { silentMin?: number; modalMax?: number } };
      };
      expect(snapshot.nexus?.trustMode?.silentMin).toBe(95);
      expect(snapshot.nexus?.trustMode?.modalMax).toBe(42);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('toggles psyche guard mode and exposes it in snapshot', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      const updated = (await client.request('psyche.mode.set', {
        resonanceEnabled: false,
        captureProbeEnabled: false,
      })) as { mode?: { resonanceEnabled?: boolean; captureProbeEnabled?: boolean } };
      expect(updated.mode?.resonanceEnabled).toBe(false);
      expect(updated.mode?.captureProbeEnabled).toBe(false);

      const snapshot = (await client.request('gateway.status.get')) as {
        nexus?: {
          psycheMode?: { resonanceEnabled?: boolean; captureProbeEnabled?: boolean };
        };
      };
      expect(snapshot.nexus?.psycheMode?.resonanceEnabled).toBe(false);
      expect(snapshot.nexus?.psycheMode?.captureProbeEnabled).toBe(false);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

  test('applies learning gate layers and enforces persistent approval policy', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      await client.request('security.identity.init', {
        password: 'pw-learning',
        passphrase: 'phrase-learning',
      });
      const gateUpdated = (await client.request('learning.gate.set', {
        candidateMode: 'toast_gate',
        persistentRequiresApproval: true,
      })) as {
        gate?: { candidateMode?: string; persistentRequiresApproval?: boolean };
      };
      expect(gateUpdated.gate?.candidateMode).toBe('toast_gate');
      expect(gateUpdated.gate?.persistentRequiresApproval).toBe(true);

      const snapshot = (await client.request('gateway.status.get')) as {
        nexus?: {
          learningGate?: {
            candidateMode?: string;
            persistentRequiresApproval?: boolean;
          };
        };
      };
      expect(snapshot.nexus?.learningGate?.candidateMode).toBe('toast_gate');
      expect(snapshot.nexus?.learningGate?.persistentRequiresApproval).toBe(true);

      const policy = (await client.request('policy.get')) as { hash: string };
      const added = (await client.request('companion.memory.add', {
        policyHash: policy.hash,
        fact: '用户喜欢低打扰的提醒',
      })) as { learningGate?: { stage?: string; approvalMode?: string } };
      expect(added.learningGate?.stage).toBe('candidate');
      expect(added.learningGate?.approvalMode).toBe('toast_gate');
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });

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
    const prevPsycheSwitch = process.env.MIYA_PSYCHE_CONSULT_ENABLE;
    process.env.MIYA_PSYCHE_CONSULT_ENABLE = '1';
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
        fixability?: string;
        budget?: { autoRetry?: number; humanEdit?: number };
      };
      expect(result.sent).toBe(false);
      expect(result.message).toBe('outbound_blocked:psyche_deferred');
      expect(Number(result.retryAfterSec ?? 0)).toBeGreaterThan(0);
      expect(result.fixability).toBe('retry_later');
      expect(Number(result.budget?.autoRetry ?? 0)).toBeGreaterThanOrEqual(1);
      expect(Number(result.budget?.humanEdit ?? 0)).toBeGreaterThanOrEqual(1);
    } finally {
      client.close();
      stopGateway(projectDir);
      if (prevPsycheSwitch === undefined) {
        delete process.env.MIYA_PSYCHE_CONSULT_ENABLE;
      } else {
        process.env.MIYA_PSYCHE_CONSULT_ENABLE = prevPsycheSwitch;
      }
    }
  });

  test('enforces fixability retry budget to prevent infinite auto-retry loops', async () => {
    const projectDir = await createGatewayAcceptanceProjectDir();
    const state = ensureGatewayRunning(projectDir);
    const client = await connectGateway(state.url);
    try {
      await client.request('security.identity.init', {
        password: 'pw-budget',
        passphrase: 'phrase-budget',
      });
      await client.request('psyche.mode.set', {
        resonanceEnabled: false,
        captureProbeEnabled: true,
      });
      const policy = (await client.request('policy.get')) as { hash: string };
      const negotiationID = 'budget-loop-1';

      const first = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '请在我忙的时候提醒我休息',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: true,
          userInitiated: false,
          negotiationID,
        },
      })) as { sent: boolean; message: string; fixability?: string };
      expect(first.sent).toBe(false);
      expect(first.fixability).toBe('retry_later');

      const second = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '请在我忙的时候提醒我休息',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: true,
          userInitiated: false,
          negotiationID,
          retryAttemptType: 'auto',
        },
      })) as { sent: boolean; message: string };
      expect(second.sent).toBe(false);

      const third = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '请在我忙的时候提醒我休息',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: true,
          userInitiated: false,
          negotiationID,
          retryAttemptType: 'auto',
        },
      })) as { sent: boolean; message: string };
      expect(third.sent).toBe(false);
      expect(third.message).toMatch(/negotiation_budget_exhausted/);

      const humanNegotiationID = 'budget-loop-human-1';
      const humanFirst = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '请在我忙的时候提醒我休息',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: true,
          userInitiated: false,
          negotiationID: humanNegotiationID,
        },
      })) as { sent: boolean; fixability?: string; budget?: { humanEdit?: number } };
      expect(humanFirst.sent).toBe(false);
      expect(humanFirst.fixability).toBe('retry_later');
      expect(Number(humanFirst.budget?.humanEdit ?? 0)).toBeGreaterThanOrEqual(1);

      const humanSecond = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '请在我忙的时候提醒我休息',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: true,
          userInitiated: false,
          negotiationID: humanNegotiationID,
          retryAttemptType: 'human',
        },
      })) as { sent: boolean; message: string };
      expect(humanSecond.sent).toBe(false);

      const humanThird = (await client.request('channels.message.send', {
        channel: 'qq',
        destination: 'owner-001',
        text: '请在我忙的时候提醒我休息',
        sessionID: 'main',
        policyHash: policy.hash,
        outboundCheck: {
          archAdvisorApproved: true,
          intent: 'initiate',
          factorRecipientIsMe: true,
          userInitiated: false,
          negotiationID: humanNegotiationID,
          retryAttemptType: 'human',
        },
      })) as { sent: boolean; message: string };
      expect(humanThird.sent).toBe(false);
      expect(humanThird.message).toMatch(/negotiation_budget_exhausted:human_edit_exhausted/);
    } finally {
      client.close();
      stopGateway(projectDir);
    }
  });
});
