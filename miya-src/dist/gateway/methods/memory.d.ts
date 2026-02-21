import type { GatewayMethodRegistrarDeps } from './types';
interface LearningGateSnapshot {
    candidateMode: 'toast_gate' | 'silent_audit';
    persistentRequiresApproval: boolean;
}
export interface MemoryMethodDeps extends GatewayMethodRegistrarDeps {
    requireOwnerMode: (projectDir: string) => void;
    requirePolicyHash: (projectDir: string, providedHash: string | undefined) => string;
    requireDomainRunning: (projectDir: string, domain: 'memory_write') => void;
    resolveApprovalTicket: (input: {
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
    getLearningGate: () => LearningGateSnapshot;
}
export declare function registerMemoryMethods(deps: MemoryMethodDeps): void;
export {};
