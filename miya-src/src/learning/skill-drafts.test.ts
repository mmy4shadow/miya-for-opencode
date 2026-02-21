import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { RalphLoopResult } from '../ralph';
import {
  buildLearningInjection,
  createSkillDraftFromRalph,
  getLearningStats,
  listSkillDrafts,
  setSkillDraftStatus,
} from './skill-drafts';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-learning-drafts-'));
}

function makeRalphResult(success: boolean): RalphLoopResult {
  return {
    success,
    iterations: 2,
    reason: success ? 'verified' : 'no_fix_command',
    summary: success ? 'verification passed' : 'verification failed',
    attempts: [
      {
        iteration: 1,
        type: 'verify',
        result: {
          command: 'npm run test',
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: 'test failed',
          durationMs: 10,
        },
        failureSummary: 'test failed',
      },
      {
        iteration: 1,
        type: 'fix',
        result: {
          command: 'npm run lint -- --fix',
          ok: true,
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 10,
        },
      },
    ],
    finalVerification: {
      command: 'npm run test',
      ok: success,
      exitCode: success ? 0 : 1,
      stdout: '',
      stderr: success ? '' : 'still failing',
      durationMs: 8,
    },
  };
}

describe('learning skill drafts', () => {
  test('creates draft from ralph result and supports recommendation', () => {
    const projectDir = tempProjectDir();
    const draft = createSkillDraftFromRalph(projectDir, {
      taskDescription: 'fix failing tests',
      result: makeRalphResult(true),
    });
    expect(draft).not.toBeNull();
    const listed = listSkillDrafts(projectDir);
    expect(listed.length).toBe(1);

    const rec = buildLearningInjection(projectDir, 'tests failing fix', {
      threshold: 0.3,
      limit: 2,
    });
    expect(rec.snippet).toContain('MIYA_LEARNING_DRAFT_REUSE');
    expect(rec.matchedDraftIDs.length).toBeGreaterThan(0);
  });

  test('tracks usage hits/misses and status transitions', () => {
    const projectDir = tempProjectDir();
    const draft = createSkillDraftFromRalph(projectDir, {
      taskDescription: 'repair compile error',
      result: makeRalphResult(false),
    });
    expect(draft).not.toBeNull();
    const id = draft?.id ?? '';

    const accepted = setSkillDraftStatus(projectDir, id, 'accepted');
    expect(accepted?.status).toBe('accepted');

    setSkillDraftStatus(projectDir, id, undefined, { hit: true });
    setSkillDraftStatus(projectDir, id, undefined, { hit: false });

    const stats = getLearningStats(projectDir);
    expect(stats.total).toBe(1);
    expect(stats.totalUses).toBe(2);
    expect(stats.hitRate).toBe(0.5);
  });
});
