import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow/state';
const DEFAULT_STATE = {
    jobs: [],
    approvals: [],
};
function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}
function nowIso() {
    return new Date().toISOString();
}
function randomId(prefix) {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${time}_${rand}`;
}
function getAutomationDir(projectDir) {
    return path.join(getMiyaRuntimeDir(projectDir), 'automation');
}
function getStatePath(projectDir) {
    return path.join(getAutomationDir(projectDir), 'state.json');
}
function getHistoryPath(projectDir) {
    return path.join(getAutomationDir(projectDir), 'history.jsonl');
}
export function readAutomationState(projectDir) {
    const statePath = getStatePath(projectDir);
    if (!fs.existsSync(statePath)) {
        return { ...DEFAULT_STATE };
    }
    try {
        const raw = fs.readFileSync(statePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
            approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
        };
    }
    catch {
        return { ...DEFAULT_STATE };
    }
}
export function writeAutomationState(projectDir, state) {
    const statePath = getStatePath(projectDir);
    ensureDir(path.dirname(statePath));
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}
export function appendHistoryRecord(projectDir, record) {
    const historyPath = getHistoryPath(projectDir);
    ensureDir(path.dirname(historyPath));
    fs.appendFileSync(historyPath, `${JSON.stringify(record)}\n`, 'utf-8');
}
export function readHistoryRecords(projectDir, limit) {
    const historyPath = getHistoryPath(projectDir);
    if (!fs.existsSync(historyPath)) {
        return [];
    }
    try {
        const lines = fs
            .readFileSync(historyPath, 'utf-8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const records = lines
            .map((line) => JSON.parse(line))
            .filter((record) => record && typeof record === 'object');
        return records.slice(Math.max(0, records.length - limit)).reverse();
    }
    catch {
        return [];
    }
}
export function createJobId() {
    return randomId('job');
}
export function createApprovalId() {
    return randomId('approval');
}
export function createHistoryId() {
    return randomId('run');
}
export function touchJob(job) {
    return {
        ...job,
        updatedAt: nowIso(),
    };
}
export function createApproval(job, reason) {
    return {
        id: createApprovalId(),
        jobId: job.id,
        reason,
        requestedAt: nowIso(),
        status: 'pending',
    };
}
