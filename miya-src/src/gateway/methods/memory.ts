import type { GatewayMethodRegistry } from '../protocol';
import { registerGatewayDomainMethods } from './domain-registration';

export function registerGatewayMemoryMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  registerGatewayDomainMethods(
    methods,
    'memory',
    ['companion.memory.', 'companion.learning.', 'miya.memory.'],
    register,
  );
}
