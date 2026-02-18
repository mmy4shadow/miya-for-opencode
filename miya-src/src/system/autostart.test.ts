import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getAutostartStatus,
  reconcileAutostartConflicts,
  setAutostartEnabled,
} from './autostart';

const originalTestMode = process.env.MIYA_AUTOSTART_TEST_MODE;
const originalTestTasks = process.env.MIYA_AUTOSTART_TEST_TASKS_JSON;

function createProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-autostart-test-'));
}

afterEach(() => {
  if (typeof originalTestMode === 'string') {
    process.env.MIYA_AUTOSTART_TEST_MODE = originalTestMode;
  } else {
    delete process.env.MIYA_AUTOSTART_TEST_MODE;
  }
  if (typeof originalTestTasks === 'string') {
    process.env.MIYA_AUTOSTART_TEST_TASKS_JSON = originalTestTasks;
  } else {
    delete process.env.MIYA_AUTOSTART_TEST_TASKS_JSON;
  }
});

describe('autostart state', () => {
  test('enables and disables in test mode without touching OS scheduler', () => {
    process.env.MIYA_AUTOSTART_TEST_MODE = '1';
    const projectDir = createProjectDir();

    const enabled = setAutostartEnabled(projectDir, {
      enabled: true,
      taskName: 'MiyaTestTask',
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.installed).toBe(true);
    expect(enabled.taskName).toBe('MiyaTestTask');

    const status = getAutostartStatus(projectDir);
    expect(status.enabled).toBe(true);
    expect(status.installed).toBe(true);
    expect(Array.isArray(status.conflicts)).toBe(true);
    expect(status.conflictDetected).toBe(false);

    const disabled = setAutostartEnabled(projectDir, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.installed).toBe(false);
  });

  test('detects and resolves conflicts in test mode', () => {
    process.env.MIYA_AUTOSTART_TEST_MODE = '1';
    process.env.MIYA_AUTOSTART_TEST_TASKS_JSON = JSON.stringify([
      {
        taskName: '\\OpenClaw Gateway',
        command: 'C:\\Users\\shadow\\.openclaw\\gateway.cmd',
        state: 'Enabled',
      },
      {
        taskName: '\\Legacy Miya Start',
        command: 'bunx miya gateway start',
        state: 'Enabled',
      },
    ]);
    const projectDir = createProjectDir();

    const status = getAutostartStatus(projectDir);
    expect(status.conflictDetected).toBe(true);
    expect(status.conflicts.length).toBe(2);

    const resolved = reconcileAutostartConflicts(projectDir, {
      disableConflicts: true,
    });
    expect(resolved.conflictCount).toBe(2);
    expect(resolved.disabled.length).toBe(2);
    expect(resolved.failed.length).toBe(0);
  });
});
