import type { GatewayMethodRegistrarDeps } from './types';
export interface SecurityMethodDeps extends GatewayMethodRegistrarDeps {
}
export declare function registerSecurityMethods(deps: SecurityMethodDeps): void;
