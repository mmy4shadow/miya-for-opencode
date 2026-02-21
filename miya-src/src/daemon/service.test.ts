import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MiyaDaemonService } from './service';
import type { DaemonJobProgressEvent } from './types';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-daemon-test-'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function longSleepCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'powershell',
      args: ['-NoProfile', '-Command', 'Start-Sleep -Seconds 30'],
    };
  }
  return {
    command: 'sh',
    args: ['-lc', 'sleep 30'],
  };
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

  test('emits audio filler cue for tasks expected to exceed 500ms', async () => {
    const events: DaemonJobProgressEvent[] = [];
    const daemon = new MiyaDaemonService(tempProjectDir(), {
      onProgress: (event) => events.push(event),
    });
    daemon.start();
    await daemon.runTask(
      {
        kind: 'image.generate',
        resource: { priority: 80, vramMB: 0, timeoutMs: 2_000 },
      },
      async () => 'ok',
    );
    const filler = events.find((event) => event.phase === 'audio.filler');
    expect(filler).toBeDefined();
    expect(filler?.audioCue?.expectedLatencyMs).toBeGreaterThan(500);
  });

  test('preempts running low-lane training process for high-priority interaction', async () => {
    const daemon = new MiyaDaemonService(tempProjectDir());
    daemon.start();

    const slow = longSleepCommand();
    const lowPromise = daemon.runIsolatedProcess({
      kind: 'training.image',
      command: slow.command,
      args: slow.args,
      timeoutMs: 60_000,
      metadata: { jobID: 'train-preempt-1' },
      resource: { priority: 10, vramMB: 0 },
    });
    await sleep(250);
    await daemon.runTask(
      {
        kind: 'vision.analyze',
        resource: { priority: 100, vramMB: 0, timeoutMs: 2_000 },
      },
      async () => 'interaction-ok',
    );
    const lowResult = await Promise.race([
      lowPromise,
      new Promise<{
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>((_, reject) => setTimeout(() => reject(new Error('preempt_timeout')), 8_000)),
    ]);
    expect(lowResult.timedOut).toBe(false);
    expect(lowResult.exitCode === 0).toBe(false);
  });

  test('returns VRAM_BUDGET_EXCEEDED when free margin drops below safety buffer', async () => {
    const daemon = new MiyaDaemonService(tempProjectDir());
    daemon.start();
    await expect(
      daemon.runTask(
        {
          kind: 'generic',
          resource: { priority: 20, vramMB: 7000, modelVramMB: 0 },
        },
        async () => 'noop',
      ),
    ).rejects.toThrow(/VRAM_BUDGET_EXCEEDED/);
  });
});
