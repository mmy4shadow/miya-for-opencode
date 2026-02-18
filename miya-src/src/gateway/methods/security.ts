import type { GatewayMethodRegistry } from '../protocol';

export function registerGatewaySecurityMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  register(methods);
}
