import { describe, expect, test } from 'bun:test';
import {
  GATEWAY_PROTOCOL_VERSION,
  LEGACY_GATEWAY_PROTOCOL_VERSION,
  SUPPORTED_GATEWAY_PROTOCOL_VERSIONS,
  GatewayMethodRegistry,
  parseIncomingFrame,
  toEventFrame,
  toPongFrame,
  toResponseFrame,
} from './protocol';

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('wait_timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('gateway protocol', () => {
  test('parses request frame', () => {
    const parsed = parseIncomingFrame(
      JSON.stringify({
        type: 'request',
        id: '1',
        method: 'gateway.status.get',
        params: { a: 1 },
      }),
    );

    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('request');
    if (parsed.frame?.type !== 'request') return;
    expect(parsed.frame.id).toBe('1');
    expect(parsed.frame.method).toBe('gateway.status.get');
    expect(parsed.frame.params?.a).toBe(1);
  });

  test('parses request frame with idempotency key', () => {
    const parsed = parseIncomingFrame(
      JSON.stringify({
        type: 'request',
        id: '2',
        method: 'sessions.send',
        params: { sessionID: 's1', text: 'hello' },
        idempotencyKey: 'k-1',
      }),
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('request');
    if (parsed.frame?.type !== 'request') return;
    expect(parsed.frame.idempotencyKey).toBe('k-1');
  });

  test('maps legacy status message', () => {
    const parsed = parseIncomingFrame('status');
    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('request');
    if (parsed.frame?.type !== 'request') return;
    expect(parsed.frame.method).toBe('gateway.status.get');
  });

  test('parses hello frame with challenge and protocol metadata', () => {
    const parsed = parseIncomingFrame(
      JSON.stringify({
        type: 'hello',
        role: 'ui',
        clientID: 'c1',
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        auth: {
          token: 't1',
          challenge: {
            nonce: 'nonce-12345678',
            ts: Date.now(),
            signature: 'abcdef1234567890',
          },
        },
      }),
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('hello');
    if (parsed.frame?.type !== 'hello') return;
    expect(parsed.frame.protocolVersion).toBe(GATEWAY_PROTOCOL_VERSION);
    expect(parsed.frame.auth?.challenge?.nonce).toBe('nonce-12345678');
    expect(SUPPORTED_GATEWAY_PROTOCOL_VERSIONS).toContain(
      LEGACY_GATEWAY_PROTOCOL_VERSION,
    );
  });

  test('parses ping frame and serializes pong', () => {
    const parsed = parseIncomingFrame(JSON.stringify({ type: 'ping', ts: 42 }));
    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('ping');
    const pong = toPongFrame(42);
    expect(pong.type).toBe('pong');
    expect(pong.ts).toBe(42);
  });

  test('invokes registry methods', async () => {
    const registry = new GatewayMethodRegistry();
    registry.register('echo', async (params) => ({ echoed: params.value }));

    const result = await registry.invoke('echo', { value: 'x' }, {
      clientID: 'c1',
      role: 'ui',
    });

    expect(result).toEqual({ echoed: 'x' });
    expect(registry.list()).toEqual(['echo']);
  });

  test('applies backpressure queue and drains in order', async () => {
    const registry = new GatewayMethodRegistry({
      maxInFlight: 1,
      maxQueued: 4,
      queueTimeoutMs: 5000,
    });
    const blockers: Array<() => void> = [];
    registry.register('slow', async (params) => {
      const order = Number(params.order ?? -1);
      await new Promise<void>((resolve) => blockers.push(resolve));
      return { order };
    });

    const first = registry.invoke('slow', { order: 1 }, { clientID: 'c1', role: 'ui' });
    const second = registry.invoke('slow', { order: 2 }, { clientID: 'c1', role: 'ui' });
    const third = registry.invoke('slow', { order: 3 }, { clientID: 'c1', role: 'ui' });

    expect(registry.stats().inFlight).toBe(1);
    expect(registry.stats().queued).toBe(2);
    expect(registry.stats().rejectedOverloaded).toBe(0);
    expect(registry.stats().rejectedTimeout).toBe(0);

    await waitFor(() => blockers.length >= 1);
    const release1 = blockers.shift();
    release1?.();
    expect(await first).toEqual({ order: 1 });

    await waitFor(() => blockers.length >= 1);
    const release2 = blockers.shift();
    release2?.();
    expect(await second).toEqual({ order: 2 });

    await waitFor(() => blockers.length >= 1);
    const release3 = blockers.shift();
    release3?.();
    expect(await third).toEqual({ order: 3 });
  });

  test('rejects when backpressure queue is full', async () => {
    const registry = new GatewayMethodRegistry({
      maxInFlight: 1,
      maxQueued: 1,
      queueTimeoutMs: 5000,
    });
    const blockers: Array<() => void> = [];
    registry.register(
      'slow',
      async () =>
        await new Promise<void>((resolve) => {
          blockers.push(resolve);
        }),
    );

    const first = registry.invoke('slow', {}, { clientID: 'c1', role: 'ui' });
    const second = registry.invoke('slow', {}, { clientID: 'c1', role: 'ui' });
    await expect(
      registry.invoke('slow', {}, { clientID: 'c1', role: 'ui' }),
    ).rejects.toThrow(/gateway_backpressure_overloaded/);
    expect(registry.stats().rejectedOverloaded).toBe(1);
    await waitFor(() => blockers.length >= 1);
    blockers.shift()?.();
    await first;
    await waitFor(() => blockers.length >= 1);
    blockers.shift()?.();
    await second;
  });

  test('marks queued timeout counter', async () => {
    const registry = new GatewayMethodRegistry({
      maxInFlight: 1,
      maxQueued: 1,
      queueTimeoutMs: 80,
    });
    let release: (() => void) | undefined;
    registry.register(
      'slow',
      async () =>
        await new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = registry.invoke('slow', {}, { clientID: 'c1', role: 'ui' });
    await expect(
      registry.invoke('slow', {}, { clientID: 'c1', role: 'ui' }),
    ).rejects.toThrow(/gateway_backpressure_timeout/);
    expect(registry.stats().rejectedTimeout).toBe(1);
    release?.();
    await first;
  });

  test('serializes response and event frames', () => {
    const ok = toResponseFrame({
      id: 'r1',
      ok: true,
      result: { ok: 1 },
    });
    expect(ok.ok).toBe(true);

    const fail = toResponseFrame({
      id: 'r2',
      ok: false,
      errorCode: 'bad_request',
      errorMessage: 'oops',
    });
    expect(fail.ok).toBe(false);
    expect(fail.error?.code).toBe('bad_request');

    const event = toEventFrame({
      event: 'gateway.snapshot',
      payload: { k: 'v' },
      stateVersion: { gateway: 1 },
    });
    expect(event.type).toBe('event');
    expect(event.event).toBe('gateway.snapshot');
  });

  test('sanitizes undefined fields in event payload', () => {
    const event = toEventFrame({
      event: 'gateway.snapshot',
      payload: {
        ok: true,
        nested: {
          value: 1,
          missing: undefined,
        },
        list: [1, undefined, 2],
      },
    });
    expect(event.payload).toEqual({
      ok: true,
      nested: {
        value: 1,
      },
      list: [1, null, 2],
    });
  });

  test('sanitizes undefined fields in response result', () => {
    const frame = toResponseFrame({
      id: 'x',
      ok: true,
      result: {
        activeAgentId: undefined,
        runtime: {
          revision: 3,
          missing: undefined,
        },
      },
    });
    expect(frame.ok).toBe(true);
    expect(frame.result).toEqual({
      runtime: {
        revision: 3,
      },
    });
  });
});
