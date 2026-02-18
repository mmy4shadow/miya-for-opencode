import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applySourcePack,
  diffSourcePack,
  listEcosystemBridge,
  preflightSourcePackGovernance,
  pullSourcePack,
  rollbackSourcePack,
  verifySourcePackGovernance,
} from './sync';

function git(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = Buffer.from(proc.stdout).toString('utf-8').trim();
  const stderr = Buffer.from(proc.stderr).toString('utf-8').trim();
  if (proc.exitCode !== 0) {
    throw new Error(`git_failed:${args.join(' ')}:${stderr}`);
  }
  return stdout;
}

function setupSkillRepoFixture(): {
  rootDir: string;
  projectDir: string;
  seedDir: string;
  remoteDir: string;
  cloneDir: string;
} {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-sync-'));
  const projectDir = path.join(rootDir, 'project');
  const skillsDir = path.join(projectDir, 'skills');
  const seedDir = path.join(rootDir, 'seed');
  const remoteDir = path.join(rootDir, 'remote.git');
  const cloneDir = path.join(skillsDir, 'ecosystem-pack');
  fs.mkdirSync(skillsDir, { recursive: true });

  git(['init', '--bare', remoteDir], rootDir);
  git(['init', seedDir], rootDir);
  git(['config', 'user.email', 'miya-sync@example.test'], seedDir);
  git(['config', 'user.name', 'Miya Sync Test'], seedDir);
  fs.writeFileSync(
    path.join(seedDir, 'SKILL.md'),
    '# skill fixture\n',
    'utf-8',
  );
  fs.writeFileSync(path.join(seedDir, 'README.md'), 'fixture\n', 'utf-8');
  git(['add', '.'], seedDir);
  git(['commit', '-m', 'init'], seedDir);
  git(['branch', '-M', 'main'], seedDir);
  git(['remote', 'add', 'origin', remoteDir], seedDir);
  git(['push', '-u', 'origin', 'main'], seedDir);
  git(
    ['--git-dir', remoteDir, 'symbolic-ref', 'HEAD', 'refs/heads/main'],
    rootDir,
  );
  git(['clone', remoteDir, cloneDir], rootDir);

  return { rootDir, projectDir, seedDir, remoteDir, cloneDir };
}

function pushRemoteUpdate(seedDir: string): string {
  fs.appendFileSync(path.join(seedDir, 'SKILL.md'), '\nupdated\n', 'utf-8');
  git(['add', 'SKILL.md'], seedDir);
  git(['commit', '-m', 'update'], seedDir);
  git(['push', 'origin', 'main'], seedDir);
  return git(['rev-parse', 'HEAD'], seedDir);
}

describe('ecosystem bridge sync', () => {
  test('supports list/pull/diff/apply/rollback lifecycle for source packs', () => {
    const fixture = setupSkillRepoFixture();
    try {
      const options = {
        sourceRoots: [path.join(fixture.projectDir, 'skills')],
      };
      const listed = listEcosystemBridge(fixture.projectDir, options);
      expect(listed.sourcePacks.length).toBe(1);
      const sourcePack = listed.sourcePacks[0];
      const initialRevision = sourcePack.headRevision;

      const latestRemoteRevision = pushRemoteUpdate(fixture.seedDir);
      const pulled = pullSourcePack(
        fixture.projectDir,
        sourcePack.sourcePackID,
        options,
      );
      expect(pulled.latestRevision).toBe(latestRemoteRevision);
      expect(pulled.governance?.lock.revision).toBe(latestRemoteRevision);
      expect(pulled.governance?.smoke.ok).toBe(true);

      const diff = diffSourcePack(
        fixture.projectDir,
        sourcePack.sourcePackID,
        options,
      );
      expect(diff.behind).toBeGreaterThanOrEqual(1);
      expect(diff.compareRevision).toBe(latestRemoteRevision);

      const applied = applySourcePack(
        fixture.projectDir,
        sourcePack.sourcePackID,
        {},
        options,
      );
      expect(applied.appliedRevision).toBe(latestRemoteRevision);
      expect(applied.detachedHead).toBe(true);
      expect(applied.governance?.signature.digest.length).toBeGreaterThan(20);

      const stable = diffSourcePack(
        fixture.projectDir,
        sourcePack.sourcePackID,
        options,
      );
      expect(stable.behind).toBe(0);

      const rolledBack = rollbackSourcePack(
        fixture.projectDir,
        sourcePack.sourcePackID,
        options,
      );
      expect(rolledBack.rolledBackTo).toBe(initialRevision);
      expect(rolledBack.detachedHead).toBe(true);
      expect(rolledBack.governance?.lock.revision).toBe(initialRevision);
      const verified = verifySourcePackGovernance(
        fixture.projectDir,
        sourcePack.sourcePackID,
        options,
      );
      expect(verified.lockValid).toBe(true);
      expect(verified.signatureValid).toBe(true);
      expect(verified.smokeValid).toBe(true);

      const finalState = listEcosystemBridge(fixture.projectDir, options);
      expect(finalState.importPlans.length).toBe(1);
      expect(finalState.pinnedReleases.length).toBe(1);
      expect(finalState.pinnedReleases[0]?.revision).toBe(initialRevision);
    } finally {
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test('blocks apply when source pack worktree is dirty', () => {
    const fixture = setupSkillRepoFixture();
    try {
      const options = {
        sourceRoots: [path.join(fixture.projectDir, 'skills')],
      };
      const listed = listEcosystemBridge(fixture.projectDir, options);
      const sourcePack = listed.sourcePacks[0];
      fs.writeFileSync(
        path.join(fixture.cloneDir, 'dirty.txt'),
        'dirty\n',
        'utf-8',
      );
      expect(() =>
        applySourcePack(
          fixture.projectDir,
          sourcePack.sourcePackID,
          { revision: sourcePack.headRevision },
          options,
        ),
      ).toThrow('source_pack_dirty_worktree');
    } finally {
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test('reports source-pack conflicts when skill names collide', () => {
    const fixture = setupSkillRepoFixture();
    try {
      const options = {
        sourceRoots: [path.join(fixture.projectDir, 'skills')],
      };
      const secondClone = path.join(
        fixture.projectDir,
        'skills',
        'ecosystem-pack-copy',
      );
      git(['clone', fixture.remoteDir, secondClone], fixture.rootDir);

      const listed = listEcosystemBridge(fixture.projectDir, options);
      expect(listed.sourcePacks.length).toBe(2);
      expect(listed.conflicts.length).toBe(1);
      expect(listed.conflicts[0]?.type).toBe('skill_name_collision');
      expect(listed.conflicts[0]?.sourcePackIDs.length).toBe(2);
    } finally {
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  test('strict preflight blocks source pack without permission metadata and regression artifacts', () => {
    const fixture = setupSkillRepoFixture();
    try {
      const options = {
        sourceRoots: [path.join(fixture.projectDir, 'skills')],
      };
      const listed = listEcosystemBridge(fixture.projectDir, options);
      const sourcePack = listed.sourcePacks[0];
      const pulled = pullSourcePack(
        fixture.projectDir,
        sourcePack.sourcePackID,
        options,
      );
      expect(pulled.governance?.smoke.ok).toBe(true);

      const preflight = preflightSourcePackGovernance(
        fixture.projectDir,
        sourcePack.sourcePackID,
        options,
      );
      expect(preflight.pass).toBe(false);
      expect(preflight.securityValid).toBe(false);
      expect(preflight.regressionValid).toBe(false);
    } finally {
      fs.rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });
});
