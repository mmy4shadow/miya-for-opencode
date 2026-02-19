import type { GatewayMethodRegistry } from '../protocol';
import { registerGatewayDomainMethods } from './domain-registration';

export function registerGatewayNodeMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  registerGatewayDomainMethods(
    methods,
    'nodes',
    [
      'nodes.',
      'devices.',
      'skills.',
      'openclaw.',
      'ecosystem.',
      'miya.sync.',
      'mcp.',
      'media.',
      'voice.',
      'canvas.',
    ],
    register,
  );
}
