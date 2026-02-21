import { describe, expect, test } from 'vitest';
import {
  DaemonRequestFrameSchema,
  DaemonResponseFrameSchema,
  parseDaemonIncomingFrame,
  parseDaemonOutgoingFrame,
} from './ws-protocol';

describe('daemon ws protocol', () => {
  test('parses incoming request with params', () => {
    const parsed = parseDaemonIncomingFrame(
      JSON.stringify({
        type: 'request',
        id: '1',
        method: 'daemon.status.get',
        params: { a: 1 },
      }),
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('request');
    if (parsed.frame?.type !== 'request') return;
    expect(parsed.frame.method).toBe('daemon.status.get');
    expect(parsed.frame.params.a).toBe(1);
  });

  test('parses outgoing response', () => {
    const parsed = parseDaemonOutgoingFrame(
      JSON.stringify(
        DaemonResponseFrameSchema.parse({
          type: 'response',
          id: 'r1',
          ok: true,
          result: { alive: true },
        }),
      ),
    );
    expect(parsed.error).toBeUndefined();
    expect(parsed.frame?.type).toBe('response');
  });

  test('validates request schema', () => {
    expect(() =>
      DaemonRequestFrameSchema.parse({
        type: 'request',
        id: '',
        method: '',
        params: {},
      }),
    ).toThrow();
  });
});
