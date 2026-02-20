import type { PolicyDomain } from './index';
import { type SemanticTag } from './semantic-tags';
export interface PolicyIncident {
    id: string;
    at: string;
    type: 'friend_tier_sensitive_violation' | 'friend_tier_initiate_violation' | 'decision_fusion_soft' | 'decision_fusion_hard' | 'manual_pause' | 'manual_resume';
    reason: string;
    channel?: string;
    destination?: string;
    auditID?: string;
    policyHash?: string;
    pausedDomains?: PolicyDomain[];
    statusByDomain?: Partial<Record<PolicyDomain, 'running' | 'paused'>>;
    semanticSummary?: {
        trigger: string;
        keyAssertion: string;
        recovery: string;
    };
    semanticTags?: SemanticTag[];
    details?: Record<string, unknown>;
}
export declare function appendPolicyIncident(projectDir: string, incident: Omit<PolicyIncident, 'id' | 'at'> & {
    id?: string;
    at?: string;
}): PolicyIncident;
export declare function listPolicyIncidents(projectDir: string, limit?: number): PolicyIncident[];
