export declare const POLICY_DOMAINS: readonly ["outbound_send", "desktop_control", "shell_exec", "fs_write", "memory_read", "memory_write", "memory_delete", "training", "media_generate", "read_only_research", "local_build"];
export type PolicyDomain = (typeof POLICY_DOMAINS)[number];
export type PolicyDomainState = 'running' | 'paused';
export interface MiyaPolicy {
    version: number;
    updatedAt: string;
    domains: Record<PolicyDomain, PolicyDomainState>;
    outbound: {
        allowedChannels: Array<'qq' | 'wechat'>;
        requireArchAdvisorApproval: boolean;
        requireAllowlist: boolean;
        minIntervalMs: number;
        burstWindowMs: number;
        burstLimit: number;
        duplicateWindowMs: number;
    };
}
export declare function readPolicy(projectDir: string): MiyaPolicy;
export declare function writePolicy(projectDir: string, patch: Partial<MiyaPolicy> & {
    outbound?: Partial<MiyaPolicy['outbound']>;
}): MiyaPolicy;
export declare function hashPolicy(policy: MiyaPolicy): string;
export declare function currentPolicyHash(projectDir: string): string;
export declare function assertPolicyHash(projectDir: string, providedHash: string | undefined): {
    ok: true;
    hash: string;
} | {
    ok: false;
    hash: string;
    reason: string;
};
export declare function isDomainRunning(projectDir: string, domain: PolicyDomain): boolean;
export declare function isPolicyDomain(value: unknown): value is PolicyDomain;
