import type { GatewayMethodRegistrarDeps } from './types';
export interface SessionMethodDeps extends GatewayMethodRegistrarDeps {
    requirePolicyHash: (projectDir: string, providedHash: string | undefined) => string;
    requireDomainRunning: (projectDir: string, domain: 'memory_write') => void;
    routeSessionMessage: (projectDir: string, input: {
        sessionID: string;
        text: string;
        source: string;
    }) => Promise<unknown>;
    wizardPromptPhotos: string;
    wizardPromptByState: (state: string) => string;
}
export declare function registerSessionMethods(deps: SessionMethodDeps): void;
