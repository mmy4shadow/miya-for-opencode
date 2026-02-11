import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMiyaRuntimeDir } from '../workflow';
import { tierAtLeast } from './tier';
const RECORD_LIMIT = 500;
const TOKEN_TTL_MS = 120_000;
const TOKEN_LIMIT_PER_SESSION = 200;
function runtimeFile(projectDir, name) {
    return path.join(getMiyaRuntimeDir(projectDir), name);
}
function ensureDir(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
}
function readJson(file, fallback) {
    if (!fs.existsSync(file))
        return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch {
        return fallback;
    }
}
function writeJson(file, value) {
    ensureDir(file);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}
function nowIso() {
    return new Date().toISOString();
}
function syncGatewayStatus(projectDir, status) {
    const file = runtimeFile(projectDir, 'gateway.json');
    if (!fs.existsSync(file))
        return;
    const current = readJson(file, {});
    if (!current || typeof current !== 'object')
        return;
    writeJson(file, { ...current, status });
}
export function createTraceId() {
    return randomUUID();
}
export function writeSelfApprovalRecord(projectDir, record) {
    const file = runtimeFile(projectDir, 'self-approval.json');
    const current = readJson(file, { records: [] });
    const next = {
        id: randomUUID(),
        created_at: nowIso(),
        ...record,
    };
    current.records = [next, ...current.records].slice(0, RECORD_LIMIT);
    writeJson(file, current);
    return next;
}
export function listRecentSelfApprovalRecords(projectDir, limit = 10) {
    const file = runtimeFile(projectDir, 'self-approval.json');
    const current = readJson(file, { records: [] });
    return current.records.slice(0, Math.max(1, limit));
}
function readTokenStore(projectDir) {
    const file = runtimeFile(projectDir, 'approval-tokens.json');
    return readJson(file, { tokens: {} });
}
function writeTokenStore(projectDir, store) {
    const file = runtimeFile(projectDir, 'approval-tokens.json');
    writeJson(file, store);
}
export function saveApprovalToken(projectDir, sessionID, token, ttlMs = TOKEN_TTL_MS) {
    const store = readTokenStore(projectDir);
    const created = new Date();
    const expires = new Date(created.getTime() + ttlMs);
    const next = {
        ...token,
        created_at: created.toISOString(),
        expires_at: expires.toISOString(),
    };
    const sessionTokens = store.tokens[sessionID] ?? {};
    sessionTokens[token.request_hash] = next;
    const normalized = Object.values(sessionTokens)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, TOKEN_LIMIT_PER_SESSION);
    store.tokens[sessionID] = Object.fromEntries(normalized.map((entry) => [entry.request_hash, entry]));
    writeTokenStore(projectDir, store);
    return next;
}
export function findApprovalToken(projectDir, sessionID, requestHashes, requiredTier) {
    const store = readTokenStore(projectDir);
    const sessionTokens = store.tokens[sessionID] ?? {};
    const now = Date.now();
    for (const hash of requestHashes) {
        const token = sessionTokens[hash];
        if (!token)
            continue;
        const expiresAt = Date.parse(token.expires_at);
        if (!Number.isFinite(expiresAt) || expiresAt < now)
            continue;
        if (!tierAtLeast(token.tier, requiredTier))
            continue;
        return token;
    }
    return null;
}
export function readKillSwitch(projectDir) {
    return readJson(runtimeFile(projectDir, 'kill-switch.json'), {
        active: false,
    });
}
export function activateKillSwitch(projectDir, reason, traceID) {
    const next = {
        active: true,
        reason,
        trace_id: traceID,
        activated_at: nowIso(),
    };
    writeJson(runtimeFile(projectDir, 'kill-switch.json'), next);
    syncGatewayStatus(projectDir, 'killswitch');
    return next;
}
export function releaseKillSwitch(projectDir) {
    const next = { active: false };
    writeJson(runtimeFile(projectDir, 'kill-switch.json'), next);
    syncGatewayStatus(projectDir, 'running');
    return next;
}
