import { GatewayMethodRegistry } from '../protocol';

export function registerGatewayChannelMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  register(methods);
}
