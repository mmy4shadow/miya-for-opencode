import type { GatewayMethodRegistry } from '../protocol';
import { registerGatewayDomainMethods } from './domain-registration';

export function registerGatewayCompanionMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  registerGatewayDomainMethods(methods, 'companion', ['companion.'], register);
}
