import { GatewayMethodRegistry } from '../protocol';

export function registerGatewayCompanionMethods(
  methods: GatewayMethodRegistry,
  register: (methods: GatewayMethodRegistry) => void,
): void {
  register(methods);
}
