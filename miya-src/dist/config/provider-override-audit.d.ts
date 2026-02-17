export interface ProviderOverrideAuditEntry {
    at: string;
    source: string;
    agentName: string;
    model?: string;
    providerID?: string;
    activeAgentId?: string;
    hasApiKey: boolean;
    hasBaseURL: boolean;
    optionKeys: string[];
}
export declare function appendProviderOverrideAudit(projectDir: string, input: Omit<ProviderOverrideAuditEntry, 'at'>): ProviderOverrideAuditEntry;
export declare function listProviderOverrideAudits(projectDir: string, limit?: number): ProviderOverrideAuditEntry[];
