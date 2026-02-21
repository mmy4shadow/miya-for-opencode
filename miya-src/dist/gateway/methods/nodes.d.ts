import type WebSocket from 'ws';
import type { GatewayMethodRegistrarDeps } from './types';
export interface NodeMethodDeps extends GatewayMethodRegistrarDeps {
    runtime: {
        nodeSockets: Map<string, WebSocket>;
        stateVersion: number;
    };
    requirePolicyHash: (projectDir: string, providedHash: string | undefined) => string;
    requireDomainRunning: (projectDir: string, domain: 'desktop_control') => void;
    enforceToken: (input: {
        projectDir: string;
        sessionID: string;
        permission: string;
        patterns: string[];
    }) => {
        ok: true;
    } | {
        ok: false;
        reason: string;
    };
    hashText: (input: string) => string;
}
export declare function registerNodeMethods(deps: NodeMethodDeps): void;
