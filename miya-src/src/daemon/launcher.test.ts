import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import {
  ensureMiyaLauncher,
  getLauncherBackpressureStats,
  getLauncherDaemonSnapshot,
  stopMiyaLauncher,
} from './launcher';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-launcher-test-'));
}

describe('daemon launcher snapshot', () => {
  test('returns empty snapshot when launcher is not started', () => {
    const projectDir = `test-project-${Date.now()}`;
    const snapshot = getLauncherDaemonSnapshot(projectDir);
    expect(snapshot.connected).toBe(false);
    expect(snapshot.pendingRequests).toBe(0);
    expect(snapshot.rejectedRequests).toBe(0);
  });

  test('returns empty backpressure stats when launcher is not started', () => {
    const projectDir = `test-project-${Date.now()}-stats`;
    const stats = getLauncherBackpressureStats(projectDir);
    expect(stats.connected).toBe(false);
    expect(stats.pendingRequests).toBe(0);
    expect(stats.rejectedRequests).toBe(0);
    expect(stats.maxPendingRequests).toBeGreaterThanOrEqual(4);
  });

  test('persists manual stop cooldown and blocks immediate relaunch', () => {
    const projectDir = tempProjectDir();
    stopMiyaLauncher(projectDir);
    const snapshot = ensureMiyaLauncher(projectDir);
    expect(snapshot.desiredState).toBe('stopped');
    expect(snapshot.lifecycleState).toBe('STOPPED');
    expect(typeof snapshot.manualStopUntil).toBe('string');
    stopMiyaLauncher(projectDir);
  });

  test('writes desiredState=stopped into runtime store when stopping without runtime', () => {
    const projectDir = tempProjectDir();
    stopMiyaLauncher(projectDir);
    const runtimeStorePath = path.join(
      getMiyaRuntimeDir(projectDir),
      'daemon',
      'launcher.runtime.json',
    );
    const store = JSON.parse(
      fs.readFileSync(runtimeStorePath, 'utf-8'),
    ) as Record<string, unknown>;
    expect(store.desiredState).toBe('stopped');
  });

  test('does not auto wake launcher when persisted desiredState is stopped and cooldown expired', () => {
    const projectDir = tempProjectDir();
    const daemonDir = path.join(getMiyaRuntimeDir(projectDir), 'daemon');
    fs.mkdirSync(daemonDir, { recursive: true });
    fs.writeFileSync(
      path.join(daemonDir, 'launcher.runtime.json'),
      `${JSON.stringify(
        {
          desiredState: 'stopped',
          runEpoch: 7,
          retryHalted: false,
          retryHaltedUntilMs: 0,
          consecutiveLaunchFailures: 0,
          manualStopUntilMs: Date.now() - 1_000,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );

    const first = ensureMiyaLauncher(projectDir);
    const second = ensureMiyaLauncher(projectDir);
    expect(first.desiredState).toBe('stopped');
    expect(first.lifecycleState).toBe('STOPPED');
    expect(second.desiredState).toBe('stopped');
    expect(second.lifecycleState).toBe('STOPPED');
    expect(second.runEpoch).toBe(first.runEpoch);
    stopMiyaLauncher(projectDir);
  });

  test('loads persisted retry halt state from launcher runtime store', () => {
    const projectDir = tempProjectDir();
    const daemonDir = path.join(getMiyaRuntimeDir(projectDir), 'daemon');
    fs.mkdirSync(daemonDir, { recursive: true });
    fs.writeFileSync(
      path.join(daemonDir, 'launcher.runtime.json'),
      `${JSON.stringify(
        {
          runEpoch: 9,
          retryHalted: true,
          retryHaltedUntilMs: Date.now() + 60_000,
          consecutiveLaunchFailures: 8,
          manualStopUntilMs: 0,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    const snapshot = ensureMiyaLauncher(projectDir);
    expect(snapshot.runEpoch).toBeGreaterThanOrEqual(9);
    expect(snapshot.retryHalted).toBe(true);
    expect(snapshot.lifecycleState).toBe('BACKOFF');
    stopMiyaLauncher(projectDir);
  });
});
