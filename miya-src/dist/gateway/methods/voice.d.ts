import type { GatewayMethodRegistrarDeps } from './types';
interface VoiceprintResult {
    mode: 'owner' | 'guest' | 'unknown';
    [key: string]: unknown;
}
export interface VoiceMethodDeps extends GatewayMethodRegistrarDeps {
    requirePolicyHash: (projectDir: string, providedHash: string | undefined) => string;
    requireDomainRunning: (projectDir: string, domain: 'memory_write' | 'memory_delete') => void;
    verifyVoiceprintWithLocalModel: (projectDir: string, input: {
        mediaPath?: string;
        speakerHint?: string;
        speakerScore?: number;
    }) => Promise<VoiceprintResult>;
    routeSessionMessage: (projectDir: string, input: {
        sessionID: string;
        text: string;
        source: string;
    }) => Promise<unknown>;
}
export declare function registerVoiceMethods(deps: VoiceMethodDeps): void;
export {};
