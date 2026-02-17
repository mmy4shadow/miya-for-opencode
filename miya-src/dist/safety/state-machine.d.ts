import type { PolicyDomain } from '../policy';
export type DomainSafetyState = 'running' | 'paused' | 'killed';
export interface SafetyStateMachine {
    version: 1;
    updatedAt: string;
    globalState: 'running' | 'killed';
    reason?: string;
    traceID?: string;
    domains: Record<PolicyDomain, DomainSafetyState>;
}
export interface SafetyTransitionAudit {
    id: string;
    at: string;
    source: string;
    reason: string;
    traceID?: string;
    policyHash?: string;
    globalState: 'running' | 'killed';
    domains: Partial<Record<PolicyDomain, DomainSafetyState>>;
}
export declare function readSafetyState(projectDir: string): SafetyStateMachine;
export declare function transitionSafetyState(projectDir: string, input: {
    source: string;
    reason: string;
    traceID?: string;
    policyHash?: string;
    globalState?: 'running' | 'killed';
    domains?: Partial<Record<PolicyDomain, DomainSafetyState>>;
}): SafetyStateMachine;
export declare function isDomainExecutionAllowed(projectDir: string, domain: PolicyDomain): boolean;
