import type { GatewayMethodRegistry } from '../protocol';

export function registerGatewayNodeMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  register(methods);
}
