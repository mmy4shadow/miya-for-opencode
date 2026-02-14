import { describe, expect, test } from 'bun:test';
import { getLauncherBackpressureStats, getLauncherDaemonSnapshot } from './launcher';

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
});
