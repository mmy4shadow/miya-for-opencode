import * as fs from 'node:fs';
import * as path from 'node:path';
const DEFAULT_STATE = {
    loopEnabled: true,
    autoContinue: true,
    maxIterationsPerWindow: 3,
    iterationCompleted: 0,
    windowStartIteration: 0,
    awaitingConfirmation: false,
    strictQualityGate: true,
    lastDone: [],
    lastMissing: [],
    lastUnresolved: [],
    autoContinueIteration: -1,
    autoContinueAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
};
function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}
export function getMiyaRuntimeDir(projectDir) {
    return path.join(projectDir, '.opencode', 'miya');
}
function getLoopStatePath(projectDir) {
    return path.join(getMiyaRuntimeDir(projectDir), 'loop-state.json');
}
function readStateFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return { sessions: {} };
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.sessions) {
            return { sessions: {} };
        }
        return { sessions: parsed.sessions };
    }
    catch {
        return { sessions: {} };
    }
}
function writeStateFile(filePath, state) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}
export function getSessionState(projectDir, sessionID) {
    const filePath = getLoopStatePath(projectDir);
    const state = readStateFile(filePath);
    const current = state.sessions[sessionID];
    if (!current) {
        return { ...DEFAULT_STATE };
    }
    return {
        ...DEFAULT_STATE,
        ...current,
    };
}
export function setSessionState(projectDir, sessionID, sessionState) {
    const filePath = getLoopStatePath(projectDir);
    const state = readStateFile(filePath);
    state.sessions[sessionID] = {
        ...DEFAULT_STATE,
        ...sessionState,
        updatedAt: new Date().toISOString(),
    };
    writeStateFile(filePath, state);
}
export function resetSessionState(projectDir, sessionID) {
    setSessionState(projectDir, sessionID, { ...DEFAULT_STATE });
}
export function isPositiveConfirmation(text) {
    const lowered = text.trim().toLowerCase();
    return (lowered === 'yes' ||
        lowered === 'y' ||
        lowered === 'continue' ||
        lowered === 'continue-work' ||
        lowered === '继续' ||
        lowered === '是');
}
export function isNegativeConfirmation(text) {
    const lowered = text.trim().toLowerCase();
    return (lowered === 'no' ||
        lowered === 'n' ||
        lowered === 'stop' ||
        lowered === 'cancel' ||
        lowered === 'cancel-work' ||
        lowered === '停止' ||
        lowered === '取消' ||
        lowered === '否');
}
export function shouldEnableStrictQualityGate(text) {
    const lowered = text.toLowerCase();
    return (lowered.includes('strict-quality-gate') ||
        lowered.includes('strict quality gate') ||
        lowered.includes('deepwork'));
}
