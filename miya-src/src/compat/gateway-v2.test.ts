import { describe, expect, test } from 'bun:test';
import { GatewayMethodRegistry } from '../gateway/protocol';
import { registerGatewayV2Aliases } from './gateway-v2';

describe('registerGatewayV2Aliases', () => {
  test('registers additive v2 aliases without removing legacy methods', async () => {
    const methods = new GatewayMethodRegistry();
    methods.register('gateway.status.get', async () => ({ ok: true }));
    methods.register('voice.input.ingest', async (params) => ({
      text: params.text ?? '',
    }));

    const report = registerGatewayV2Aliases(methods);
    expect(report.created).toBe(2);
    expect(methods.has('gateway.status.get')).toBe(true);
    expect(methods.has('v2.gateway.status.get')).toBe(true);

    const out = (await methods.invoke(
      'v2.voice.input.ingest',
      { text: 'hello' },
      {
        clientID: 'test',
        role: 'admin',
      },
    )) as { text?: string };
    expect(out.text).toBe('hello');
  });
});
