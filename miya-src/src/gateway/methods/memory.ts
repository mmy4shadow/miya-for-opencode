import { GatewayMethodRegistry } from '../protocol';

export function registerGatewayMemoryMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  register(methods);
}
