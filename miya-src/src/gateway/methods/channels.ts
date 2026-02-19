import type { GatewayMethodRegistry } from '../protocol';
import { registerGatewayDomainMethods } from './domain-registration';

export function registerGatewayChannelMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  registerGatewayDomainMethods(methods, 'channels', ['channels.'], register);
}
