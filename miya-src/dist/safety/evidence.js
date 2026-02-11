import * as fs from 'node:fs';
import * as path from 'node:path';
const MAX_OUTPUT = 8_000;
const LARGE_FILE_LIMIT = 2 * 1024 * 1024;
const SECRET_RULES = [
    { name: 'openai', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { name: 'github_pat', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { name: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
    { name: 'aws_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
function truncate(text) {
    if (text.length <= MAX_OUTPUT)
        return text;
    return `${text.slice(0, MAX_OUTPUT)}\n...[truncated]`;
}
async function runCommand(projectDir, command, timeoutMs = 60_000) {
    const proc = Bun.spawn({
        cmd: command,
        cwd: projectDir,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
    }, timeoutMs);
    const code = await proc.exited;
    clearTimeout(timer);
    const stdout = truncate(await new Response(proc.stdout).text());
    const stderr = truncate(await new Response(proc.stderr).text());
    return {
        ok: code === 0 && !timedOut,
        code,
        stdout,
        stderr: timedOut ? `${stderr}\n[timeout]` : stderr,
    };
}
function scanSecrets(content) {
    const hits = [];
    for (const rule of SECRET_RULES) {
        if (rule.pattern.test(content)) {
            hits.push(rule.name);
        }
    }
    return hits;
}
export async function collectSafetyEvidence(projectDir, tier) {
    const checks = [];
    const evidence = [];
    const issues = [];
    const status = await runCommand(projectDir, ['git', 'status', '--porcelain']);
    checks.push('git status --porcelain');
    evidence.push(`git_status_exit=${status.code}`);
    if (status.stdout)
        evidence.push(`git_status:\n${status.stdout}`);
    if (!status.ok)
        issues.push(`git status failed: ${status.stderr || status.code}`);
    const diffStat = await runCommand(projectDir, ['git', 'diff', '--stat']);
    checks.push('git diff --stat');
    evidence.push(`git_diff_stat_exit=${diffStat.code}`);
    if (diffStat.stdout)
        evidence.push(`git_diff_stat:\n${diffStat.stdout}`);
    if (!diffStat.ok)
        issues.push(`git diff --stat failed: ${diffStat.stderr || diffStat.code}`);
    const changed = await runCommand(projectDir, ['git', 'diff', '--name-only']);
    const changedFiles = changed.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (changedFiles.some((file) => file.startsWith('miya-src/'))) {
        const test = await runCommand(projectDir, ['bun', '--cwd', 'miya-src', 'test'], 120_000);
        checks.push('bun --cwd miya-src test');
        evidence.push(`miya_test_exit=${test.code}`);
        if (test.stdout)
            evidence.push(`miya_test_stdout:\n${test.stdout}`);
        if (test.stderr)
            evidence.push(`miya_test_stderr:\n${test.stderr}`);
        if (!test.ok)
            issues.push('miya-src tests failed');
    }
    if (tier === 'THOROUGH') {
        const diff = await runCommand(projectDir, ['git', 'diff']);
        checks.push('git diff');
        evidence.push(`git_diff_exit=${diff.code}`);
        const diffText = [diff.stdout, diff.stderr].filter(Boolean).join('\n');
        if (diffText)
            evidence.push(`git_diff:\n${diffText}`);
        if (!diff.ok)
            issues.push(`git diff failed: ${diff.stderr || diff.code}`);
        const secretHits = scanSecrets(diffText);
        if (secretHits.length > 0) {
            issues.push(`secret scan matched: ${secretHits.join(', ')}`);
        }
        checks.push('secret scan (workspace diff)');
        const oversized = changedFiles
            .map((file) => {
            const full = path.join(projectDir, file);
            if (!fs.existsSync(full))
                return null;
            const stat = fs.statSync(full);
            if (!stat.isFile())
                return null;
            if (stat.size <= LARGE_FILE_LIMIT)
                return null;
            return `${file} (${stat.size} bytes)`;
        })
            .filter((line) => line !== null);
        checks.push('large file scan (2MB)');
        if (oversized.length > 0) {
            issues.push(`large file threshold exceeded: ${oversized.join(', ')}`);
        }
    }
    return {
        pass: issues.length === 0,
        checks,
        evidence,
        issues,
    };
}
