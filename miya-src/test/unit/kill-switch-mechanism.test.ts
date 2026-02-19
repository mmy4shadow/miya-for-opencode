import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readKillSwitch } from '../../src/safety/store';
import { getMiyaRuntimeDir } from '../../src/workflow';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-kill-switch-'));
}

function writeKillSwitch(projectDir: string, payload: unknown): void {
  const runtimeDir = getMiyaRuntimeDir(projectDir);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, 'kill-switch.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf-8',
  );
}

describe('kill-switch mechanism hardening', () => {
  test('normalizes string false to inactive state', () => {
    const projectDir = tempProjectDir();
    writeKillSwitch(projectDir, {
      active: 'false',
      reason: 'manual_test',
      trace_id: 'trace-1',
      activated_at: 'invalid-date',
    });

    const kill = readKillSwitch(projectDir);
    expect(kill.active).toBe(false);
    expect(kill.reason).toBe('manual_test');
    expect(kill.trace_id).toBe('trace-1');
    expect(kill.activated_at).toBeUndefined();
  });

  test('normalizes string true to active state', () => {
    const projectDir = tempProjectDir();
    writeKillSwitch(projectDir, {
      active: 'true',
      reason: 'security_freeze',
      trace_id: 'trace-2',
      activated_at: new Date().toISOString(),
    });

    const kill = readKillSwitch(projectDir);
    expect(kill.active).toBe(true);
    expect(kill.reason).toBe('security_freeze');
    expect(kill.trace_id).toBe('trace-2');
  });
});

