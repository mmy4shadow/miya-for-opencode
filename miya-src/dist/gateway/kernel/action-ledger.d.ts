import type { GatewayClientRole } from '../protocol';
export type ActionLedgerStatus = 'completed' | 'failed';
export interface ToolActionLedgerEvent {
    id: string;
    at: string;
    method: string;
    clientID: string;
    role: GatewayClientRole;
    status: ActionLedgerStatus;
    inputSummary: string;
    inputHash: string;
    approvalBasis: string;
    resultHash: string;
    replayToken: string;
    previousHash: string;
    entryHash: string;
}
export interface ToolActionLedgerIssue {
    line: number;
    id?: string;
    reason: string;
}
export interface ToolActionLedgerVerificationReport {
    ok: boolean;
    total: number;
    valid: number;
    issues: ToolActionLedgerIssue[];
}
export declare function appendToolActionLedgerEvent(projectDir: string, input: {
    method: string;
    clientID: string;
    role: GatewayClientRole;
    params: Record<string, unknown>;
    status: ActionLedgerStatus;
    result?: unknown;
    error?: unknown;
    approvalBasis?: string;
}): ToolActionLedgerEvent;
export declare function listToolActionLedgerEvents(projectDir: string, limit?: number): ToolActionLedgerEvent[];
export declare function verifyToolActionLedger(projectDir: string): ToolActionLedgerVerificationReport;
