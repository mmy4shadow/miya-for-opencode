import { spawn } from 'node:child_process';
import { appendHistoryRecord, createApproval, createHistoryId, createJobId, readAutomationState, readHistoryRecords, touchJob, writeAutomationState, } from './store';
const SCHEDULER_INTERVAL_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
function nowIso() {
    return new Date().toISOString();
}
function parseDailyTime(time) {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
    if (!match)
        return null;
    return {
        hour: Number(match[1]),
        minute: Number(match[2]),
    };
}
function computeNextDailyRun(time, from = new Date()) {
    const parsed = parseDailyTime(time);
    if (!parsed) {
        throw new Error(`Invalid daily time format: ${time}. Expected HH:mm`);
    }
    const next = new Date(from);
    next.setHours(parsed.hour, parsed.minute, 0, 0);
    if (next.getTime() <= from.getTime()) {
        next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
}
function truncateOutput(text, maxLength = 20_000) {
    if (text.length <= maxLength)
        return text;
    return `${text.slice(0, maxLength)}\n...[truncated]`;
}
async function runCommand(command, cwd, timeoutMs) {
    const startedAt = nowIso();
    const result = await new Promise((resolve) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            env: process.env,
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({ exitCode: code, timedOut, stdout, stderr });
        });
        child.on('error', (error) => {
            clearTimeout(timeout);
            resolve({
                exitCode: null,
                timedOut,
                stdout,
                stderr: `${stderr}\n${error.message}`,
            });
        });
    });
    const endedAt = nowIso();
    const status = result.exitCode === 0 && !result.timedOut ? 'success' : 'failed';
    return {
        status,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
        startedAt,
        endedAt,
    };
}
export class MiyaAutomationService {
    projectDir;
    timer = null;
    running = false;
    constructor(projectDir) {
        this.projectDir = projectDir;
    }
    getProjectDir() {
        return this.projectDir;
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            void this.tick();
        }, SCHEDULER_INTERVAL_MS);
        this.timer.unref?.();
        void this.tick();
    }
    stop() {
        if (!this.timer)
            return;
        clearInterval(this.timer);
        this.timer = null;
    }
    async tick() {
        if (this.running)
            return;
        this.running = true;
        try {
            const state = readAutomationState(this.projectDir);
            const now = new Date();
            for (const job of state.jobs) {
                if (!job.enabled)
                    continue;
                const due = new Date(job.nextRunAt).getTime() <= now.getTime();
                if (!due)
                    continue;
                if (job.requireApproval) {
                    const hasPendingApproval = state.approvals.some((approval) => approval.jobId === job.id && approval.status === 'pending');
                    if (!hasPendingApproval) {
                        const approval = createApproval(job, 'Scheduled run is due');
                        state.approvals.push(approval);
                        job.lastApprovalId = approval.id;
                        job.lastStatus = 'skipped';
                    }
                    job.nextRunAt = computeNextDailyRun(job.schedule.time, now);
                    job.updatedAt = nowIso();
                    continue;
                }
                await this.executeJobInState(state, job.id, 'scheduler');
            }
            writeAutomationState(this.projectDir, state);
        }
        finally {
            this.running = false;
        }
    }
    listJobs() {
        return readAutomationState(this.projectDir).jobs;
    }
    listApprovals() {
        return readAutomationState(this.projectDir).approvals;
    }
    listHistory(limit = 20) {
        return readHistoryRecords(this.projectDir, limit);
    }
    scheduleDailyCommand(input) {
        const now = new Date();
        const job = {
            id: createJobId(),
            name: input.name,
            enabled: true,
            requireApproval: input.requireApproval ?? false,
            schedule: {
                type: 'daily',
                time: input.time,
            },
            action: {
                type: 'command',
                command: input.command,
                cwd: input.cwd,
                timeoutMs: input.timeoutMs,
            },
            nextRunAt: computeNextDailyRun(input.time, now),
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        const state = readAutomationState(this.projectDir);
        state.jobs.push(job);
        writeAutomationState(this.projectDir, state);
        return job;
    }
    deleteJob(jobId) {
        const state = readAutomationState(this.projectDir);
        const before = state.jobs.length;
        state.jobs = state.jobs.filter((job) => job.id !== jobId);
        state.approvals = state.approvals.filter((approval) => approval.jobId !== jobId);
        const changed = state.jobs.length !== before;
        if (changed)
            writeAutomationState(this.projectDir, state);
        return changed;
    }
    setJobEnabled(jobId, enabled) {
        const state = readAutomationState(this.projectDir);
        const job = state.jobs.find((item) => item.id === jobId);
        if (!job)
            return null;
        job.enabled = enabled;
        if (enabled) {
            job.nextRunAt = computeNextDailyRun(job.schedule.time, new Date());
        }
        job.updatedAt = nowIso();
        writeAutomationState(this.projectDir, state);
        return job;
    }
    async runJobNow(jobId) {
        const state = readAutomationState(this.projectDir);
        const result = await this.executeJobInState(state, jobId, 'manual');
        writeAutomationState(this.projectDir, state);
        return result;
    }
    async approveAndRun(approvalId) {
        const state = readAutomationState(this.projectDir);
        const approval = state.approvals.find((item) => item.id === approvalId);
        if (!approval || approval.status !== 'pending')
            return null;
        approval.status = 'approved';
        approval.resolvedAt = nowIso();
        const result = await this.executeJobInState(state, approval.jobId, 'approval');
        writeAutomationState(this.projectDir, state);
        return { approval, result };
    }
    rejectApproval(approvalId) {
        const state = readAutomationState(this.projectDir);
        const approval = state.approvals.find((item) => item.id === approvalId);
        if (!approval || approval.status !== 'pending')
            return null;
        approval.status = 'rejected';
        approval.resolvedAt = nowIso();
        writeAutomationState(this.projectDir, state);
        return approval;
    }
    async executeJobInState(state, jobId, trigger) {
        const job = state.jobs.find((item) => item.id === jobId);
        if (!job)
            return null;
        if (!job.enabled && trigger !== 'manual')
            return null;
        const timeoutMs = job.action.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
        const result = await runCommand(job.action.command, job.action.cwd, timeoutMs);
        job.lastRunAt = result.endedAt;
        job.lastStatus = result.status;
        job.lastExitCode = result.exitCode;
        if (trigger !== 'scheduler') {
            job.nextRunAt = computeNextDailyRun(job.schedule.time, new Date());
        }
        Object.assign(job, touchJob(job));
        const history = {
            id: createHistoryId(),
            jobId: job.id,
            jobName: job.name,
            trigger,
            startedAt: result.startedAt,
            endedAt: result.endedAt,
            status: result.status,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stdout: result.stdout,
            stderr: result.stderr,
        };
        appendHistoryRecord(this.projectDir, history);
        return result;
    }
}
