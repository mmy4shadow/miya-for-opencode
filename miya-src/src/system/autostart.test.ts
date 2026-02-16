import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getAutostartStatus, setAutostartEnabled } from './autostart';

const originalTestMode = process.env.MIYA_AUTOSTART_TEST_MODE;

function createProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-autostart-test-'));
}

afterEach(() => {
  if (typeof originalTestMode === 'string') {
    process.env.MIYA_AUTOSTART_TEST_MODE = originalTestMode;
  } else {
    delete process.env.MIYA_AUTOSTART_TEST_MODE;
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

    const disabled = setAutostartEnabled(projectDir, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.installed).toBe(false);
  });
});
