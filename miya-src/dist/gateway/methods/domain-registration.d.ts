import type { GatewayMethodRegistry } from '../protocol';
export declare function registerGatewayDomainMethods(methods: GatewayMethodRegistry, domain: string, prefixes: readonly string[], register: (methods: GatewayMethodRegistry) => void): void;
