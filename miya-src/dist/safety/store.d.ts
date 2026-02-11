import { type SafetyTier } from './tier';
export interface SelfApprovalRecord {
    id: string;
    trace_id: string;
    session_id: string;
    request_hash?: string;
    action: string;
    tier: SafetyTier;
    status: 'allow' | 'deny';
    reason: string;
    checks: string[];
    evidence: string[];
    executor: {
        agent: string;
        plan: string;
    };
    verifier: {
        agent: string;
        verdict: 'allow' | 'deny';
        summary: string;
    };
    rollback: {
        strategy: string;
    };
    created_at: string;
}
export interface ApprovalToken {
    trace_id: string;
    request_hash: string;
    tier: SafetyTier;
    created_at: string;
    expires_at: string;
    action: string;
}
interface KillSwitchState {
    active: boolean;
    reason?: string;
    trace_id?: string;
    activated_at?: string;
}
export declare function createTraceId(): string;
export declare function writeSelfApprovalRecord(projectDir: string, record: Omit<SelfApprovalRecord, 'id' | 'created_at'>): SelfApprovalRecord;
export declare function listRecentSelfApprovalRecords(projectDir: string, limit?: number): SelfApprovalRecord[];
export declare function saveApprovalToken(projectDir: string, sessionID: string, token: Omit<ApprovalToken, 'created_at' | 'expires_at'>, ttlMs?: number): ApprovalToken;
export declare function findApprovalToken(projectDir: string, sessionID: string, requestHashes: string[], requiredTier: SafetyTier): ApprovalToken | null;
export declare function readKillSwitch(projectDir: string): KillSwitchState;
export declare function activateKillSwitch(projectDir: string, reason: string, traceID: string): KillSwitchState;
export declare function releaseKillSwitch(projectDir: string): KillSwitchState;
export {};
