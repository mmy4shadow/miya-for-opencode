import { describe, expect, test } from 'bun:test';
import { registerGatewayChannelMethods } from '../../src/gateway/methods/channels';
import { registerGatewayCompanionMethods } from '../../src/gateway/methods/companion';
import { registerGatewayMemoryMethods } from '../../src/gateway/methods/memory';
import { registerGatewayNodeMethods } from '../../src/gateway/methods/nodes';
import { registerGatewaySecurityMethods } from '../../src/gateway/methods/security';
import { GatewayMethodRegistry } from '../../src/gateway/protocol';

describe('gateway method domain separation', () => {
  test('rejects method override inside domain registration callback', () => {
    const methods = new GatewayMethodRegistry();
    methods.register('channels.list', async () => ({ ok: true }));

    expect(() =>
      registerGatewayChannelMethods(methods, (registry) => {
        registry.register('channels.list', async () => ({ ok: false }));
      }),
    ).toThrow('gateway_domain_registration_override:channels:channels.list');
  });

  test('accepts valid per-domain method prefixes', () => {
    const methods = new GatewayMethodRegistry();
    registerGatewayChannelMethods(methods, (registry) => {
      registry.register('channels.list', async () => []);
    });
    registerGatewayCompanionMethods(methods, (registry) => {
      registry.register('companion.asset.add', async () => ({ ok: true }));
    });
    registerGatewayMemoryMethods(methods, (registry) => {
      registry.register('miya.memory.sqlite.stats', async () => ({ ok: true }));
    });
    registerGatewayNodeMethods(methods, (registry) => {
      registry.register('nodes.list', async () => []);
    });
    registerGatewaySecurityMethods(methods, (registry) => {
      registry.register('security.audit', async () => ({ ok: true }));
    });

    expect(methods.has('channels.list')).toBe(true);
    expect(methods.has('companion.asset.add')).toBe(true);
    expect(methods.has('miya.memory.sqlite.stats')).toBe(true);
    expect(methods.has('nodes.list')).toBe(true);
    expect(methods.has('security.audit')).toBe(true);
  });
});
