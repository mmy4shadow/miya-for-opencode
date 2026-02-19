import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectSafetyEvidence } from '../../src/safety/evidence';

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function tempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-evidence-'));
  runGit(dir, ['init']);
  runGit(dir, ['config', 'user.name', 'miya-test']);
  runGit(dir, ['config', 'user.email', 'miya-test@example.com']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n', 'utf-8');
  runGit(dir, ['add', 'README.md']);
  runGit(dir, ['commit', '-m', 'seed']);
  return dir;
}

describe('evidence bundle standards', () => {
  test('thorough scan includes staged files when checking large file threshold', async () => {
    const repo = tempGitRepo();
    const largeFile = path.join(repo, 'oversized-artifact.bin');
    fs.writeFileSync(largeFile, Buffer.alloc(2 * 1024 * 1024 + 512, 97));
    runGit(repo, ['add', 'oversized-artifact.bin']);

    const result = await collectSafetyEvidence(repo, 'THOROUGH');
    const hasLargeFileIssue = result.issues.some((issue) =>
      issue.includes('large file threshold exceeded'),
    );

    expect(hasLargeFileIssue).toBe(true);
  });
});

