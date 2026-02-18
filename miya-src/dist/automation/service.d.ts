import type { MiyaApprovalRequest, MiyaJob, MiyaJobHistoryRecord, MiyaJobRunResult } from './types';
export declare class MiyaAutomationService {
    private readonly projectDir;
    private timer;
    private running;
    constructor(projectDir: string);
    getProjectDir(): string;
    start(): void;
    stop(): void;
    tick(): Promise<void>;
    listJobs(): MiyaJob[];
    listApprovals(): MiyaApprovalRequest[];
    listHistory(limit?: number): MiyaJobHistoryRecord[];
    deleteHistoryRecord(runId: string): boolean;
    scheduleDailyCommand(input: {
        name: string;
        time: string;
        command: string;
        cwd?: string;
        timeoutMs?: number;
        requireApproval?: boolean;
    }): MiyaJob;
    deleteJob(jobId: string): boolean;
    setJobEnabled(jobId: string, enabled: boolean): MiyaJob | null;
    runJobNow(jobId: string): Promise<MiyaJobRunResult | null>;
    approveAndRun(approvalId: string): Promise<{
        approval: MiyaApprovalRequest;
        result: MiyaJobRunResult | null;
    } | null>;
    rejectApproval(approvalId: string): MiyaApprovalRequest | null;
    private executeJobInState;
}
