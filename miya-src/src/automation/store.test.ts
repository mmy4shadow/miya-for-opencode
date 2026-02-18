import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendHistoryRecord,
  readHistoryRecords,
  removeHistoryRecord,
} from './store';
import type { MiyaJobHistoryRecord } from './types';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-automation-store-test-'));
}

function makeRecord(id: string): MiyaJobHistoryRecord {
  return {
    id,
    jobId: 'job-test',
    jobName: 'test job',
    trigger: 'manual',
    startedAt: '2026-02-17T10:00:00.000Z',
    endedAt: '2026-02-17T10:00:02.000Z',
    status: 'success',
    exitCode: 0,
    timedOut: false,
    stdout: 'ok',
    stderr: '',
  };
}

describe('automation history store', () => {
  test('removeHistoryRecord deletes exactly one run record', () => {
    const projectDir = tempProjectDir();
    appendHistoryRecord(projectDir, makeRecord('run-1'));
    appendHistoryRecord(projectDir, makeRecord('run-2'));
    appendHistoryRecord(projectDir, makeRecord('run-3'));

    const removed = removeHistoryRecord(projectDir, 'run-2');
    expect(removed).toBe(true);

    const records = readHistoryRecords(projectDir, 10);
    expect(records.map((item) => item.id)).toEqual(['run-3', 'run-1']);
  });

  test('removeHistoryRecord returns false when run id does not exist', () => {
    const projectDir = tempProjectDir();
    appendHistoryRecord(projectDir, makeRecord('run-1'));

    const removed = removeHistoryRecord(projectDir, 'not-exist');
    expect(removed).toBe(false);

    const records = readHistoryRecords(projectDir, 10);
    expect(records.map((item) => item.id)).toEqual(['run-1']);
  });
});
