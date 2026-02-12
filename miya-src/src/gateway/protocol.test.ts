import { describe, expect, test } from 'bun:test';
import {
  GatewayMethodRegistry,
  parseIncomingFrame,
  toEventFrame,
  toResponseFrame,
} from './protocol';

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

  test('maps legacy status message', () => {
    const parsed = parseIncomingFrame('status');
    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('request');
    if (parsed.frame?.type !== 'request') return;
    expect(parsed.frame.method).toBe('gateway.status.get');
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
});
