import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

function read(relativePath: string): string {
  const file = path.join(import.meta.dir, '..', relativePath);
  return fs.readFileSync(file, 'utf-8');
}

describe('daemon lifecycle guards', () => {
  test('launcher keeps pid lock + parent lock + reconnect/heartbeat guards', () => {
    const launcher = read('daemon/launcher.ts');
    expect(launcher.includes("'daemon.pid'")).toBe(true);
    expect(launcher.includes("'parent.lock.json'")).toBe(true);
    expect(launcher.includes('cleanupExistingDaemon')).toBe(true);
    expect(launcher.includes('writeParentLock(runtime);')).toBe(true);
    expect(
      launcher.includes("safeInterval('launcher.parent.beat', 10_000"),
    ).toBe(true);
    expect(
      launcher.includes(
        'if (!runtime.ws || runtime.ws.readyState !== WebSocket.OPEN) return;',
      ),
    ).toBe(true);
  });

  test('host enforces parent-lock and heartbeat self-termination', () => {
    const host = read('daemon/host.ts');
    expect(host.includes('const parentWatchTimer = setInterval')).toBe(true);
    expect(host.includes('Date.now() - missingParentSince >= 30_000')).toBe(
      true,
    );
    expect(host.includes('const heartbeatWatchTimer = setInterval')).toBe(true);
    expect(host.includes('Date.now() - lastSeenMs >= 30_000')).toBe(true);
  });

  test('python workers include stdin eof watchdog', () => {
    const scripts = [
      'python/infer_flux.py',
      'python/infer_sovits.py',
      'python/train_flux_lora.py',
      'python/train_sovits.py',
    ];
    for (const script of scripts) {
      const content = read(`../${script}`);
      expect(content.includes('MIYA_PARENT_STDIN_MONITOR')).toBe(true);
      expect(content.includes('sys.stdin.buffer.read(1)')).toBe(true);
    }
  });
});
