import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MiyaDaemonService } from './service';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-daemon-test-'));
}

describe('daemon service', () => {
  test('runs task through scheduler wrapper', async () => {
    const daemon = new MiyaDaemonService(tempProjectDir());
    daemon.start();
    const { result, job } = await daemon.runTask(
      {
        kind: 'generic',
        resource: { priority: 20, vramMB: 0 },
      },
      async () => 'ok',
    );
    expect(result).toBe('ok');
    expect(job.status).toBe('completed');
  });

  test('runs isolated process with output capture', async () => {
    const daemon = new MiyaDaemonService(tempProjectDir());
    daemon.start();
    const proc = await daemon.runIsolatedProcess({
      kind: 'shell.exec',
      command: process.platform === 'win32' ? 'powershell' : 'sh',
      args:
        process.platform === 'win32'
          ? ['-NoProfile', '-Command', 'Write-Output "miya-daemon"']
          : ['-lc', 'echo miya-daemon'],
      timeoutMs: 5000,
      resource: { priority: 50, vramMB: 0 },
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toLowerCase()).toContain('miya-daemon');
  });

  test('builds and applies model update plan', () => {
    const daemon = new MiyaDaemonService(tempProjectDir());
    const plan = daemon.getModelUpdatePlan();
    expect(plan.items.length).toBeGreaterThanOrEqual(2);
    expect(plan.pending).toBeGreaterThanOrEqual(1);

    const applied = daemon.applyModelUpdate();
    expect(applied.updated.length).toBeGreaterThanOrEqual(1);

    const nextPlan = daemon.getModelUpdatePlan();
    expect(nextPlan.pending).toBe(0);
  });
});
