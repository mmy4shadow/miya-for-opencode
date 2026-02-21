import type { GatewayMethodContext, GatewayMethodRegistry } from '../protocol';
export interface GatewayMethodRegistrarDeps {
    projectDir: string;
    methods: GatewayMethodRegistry;
    parseText: (value: unknown) => string;
}
export type MethodParams = Record<string, unknown>;
export type MethodContext = GatewayMethodContext;
