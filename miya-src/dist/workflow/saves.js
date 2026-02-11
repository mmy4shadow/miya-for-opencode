import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
function getSavesDir(projectDir) {
    return path.join(projectDir, '.opencode', 'cowork-saves');
}
function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}
function timestampId() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${y}${m}${d}_${hh}${mm}${ss}`;
}
export function getCurrentBranch(projectDir) {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectDir,
        encoding: 'utf-8',
    });
    if (result.status !== 0)
        return null;
    return result.stdout.trim() || null;
}
function savePath(projectDir, id) {
    return path.join(getSavesDir(projectDir), `${id}.json`);
}
export function createSaveRecord(projectDir, input) {
    const id = timestampId();
    const record = {
        id,
        label: input.label,
        createdAt: new Date().toISOString(),
        sessionID: input.sessionID,
        branch: getCurrentBranch(projectDir),
        done: input.done,
        missing: input.missing,
        unresolved: input.unresolved,
        notes: input.notes,
    };
    ensureDir(getSavesDir(projectDir));
    fs.writeFileSync(savePath(projectDir, id), `${JSON.stringify(record, null, 2)}\n`);
    return record;
}
export function loadSaveRecord(projectDir, id) {
    const filePath = savePath(projectDir, id);
    if (!fs.existsSync(filePath))
        return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function listSaveRecords(projectDir) {
    const dir = getSavesDir(projectDir);
    if (!fs.existsSync(dir))
        return [];
    const files = fs
        .readdirSync(dir)
        .filter((fileName) => fileName.endsWith('.json'))
        .sort();
    const records = [];
    for (const fileName of files) {
        const fullPath = path.join(dir, fileName);
        try {
            const raw = fs.readFileSync(fullPath, 'utf-8');
            records.push(JSON.parse(raw));
        }
        catch {
            // skip broken save file
        }
    }
    return records;
}
export function evaluateSave(record) {
    if (record.missing.length === 0 && record.unresolved.length === 0) {
        return { status: 'complete', reason: 'No missing or unresolved items' };
    }
    return {
        status: 'incomplete',
        reason: `missing=${record.missing.length}, unresolved=${record.unresolved.length}`,
    };
}
