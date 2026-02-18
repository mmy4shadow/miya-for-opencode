import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isDomainExecutionAllowed,
  readSafetyState,
  transitionSafetyState,
} from './state-machine';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-safety-state-test-'));
}

describe('safety state machine', () => {
  test('unifies domain pause and global kill switch semantics', () => {
    const projectDir = tempProjectDir();
    const init = readSafetyState(projectDir);
    expect(init.globalState).toBe('running');
    expect(isDomainExecutionAllowed(projectDir, 'outbound_send')).toBe(true);

    const paused = transitionSafetyState(projectDir, {
      source: 'test',
      reason: 'manual_pause:outbound_send',
      domains: { outbound_send: 'paused' },
    });
    expect(paused.domains.outbound_send).toBe('paused');
    expect(isDomainExecutionAllowed(projectDir, 'outbound_send')).toBe(false);

    const killed = transitionSafetyState(projectDir, {
      source: 'test',
      reason: 'hard_fuse',
      globalState: 'killed',
    });
    expect(killed.globalState).toBe('killed');
    expect(isDomainExecutionAllowed(projectDir, 'memory_write')).toBe(false);
  });
});
