import type { GatewayMethodRegistry } from '../protocol';
import { registerGatewayDomainMethods } from './domain-registration';

export function registerGatewaySecurityMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  registerGatewayDomainMethods(
    methods,
    'security',
    [
      'security.',
      'policy.',
      'daemon.',
      'killswitch.',
      'intervention.',
      'trust.',
      'psyche.',
      'learning.',
      'insight.',
    ],
    register,
  );
}
