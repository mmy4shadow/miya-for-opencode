export interface MiyaDailySchedule {
    type: 'daily';
    time: string;
}
export interface MiyaCommandAction {
    type: 'command';
    command: string;
    cwd?: string;
    timeoutMs?: number;
}
export type MiyaJobSchedule = MiyaDailySchedule;
export type MiyaJobAction = MiyaCommandAction;
export interface MiyaApprovalRequest {
    id: string;
    jobId: string;
    reason: string;
    requestedAt: string;
    status: 'pending' | 'approved' | 'rejected';
    resolvedAt?: string;
}
export interface MiyaJob {
    id: string;
    name: string;
    enabled: boolean;
    requireApproval: boolean;
    schedule: MiyaJobSchedule;
    action: MiyaJobAction;
    nextRunAt: string;
    lastRunAt?: string;
    lastStatus?: 'success' | 'failed' | 'skipped';
    lastExitCode?: number | null;
    lastApprovalId?: string;
    createdAt: string;
    updatedAt: string;
}
export interface MiyaAutomationState {
    jobs: MiyaJob[];
    approvals: MiyaApprovalRequest[];
}
export interface MiyaJobRunResult {
    status: 'success' | 'failed' | 'skipped';
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    startedAt: string;
    endedAt: string;
}
export interface MiyaJobHistoryRecord {
    id: string;
    jobId: string;
    jobName: string;
    trigger: 'scheduler' | 'manual' | 'approval';
    startedAt: string;
    endedAt: string;
    status: 'success' | 'failed' | 'skipped';
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
}
