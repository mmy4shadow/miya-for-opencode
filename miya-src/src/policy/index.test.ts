import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertPolicyHash, currentPolicyHash, readPolicy, writePolicy } from './index';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-policy-test-'));
}

describe('policy hash guard', () => {
  test('creates default policy and validates hash', () => {
    const projectDir = tempProjectDir();
    const policy = readPolicy(projectDir);
    expect(policy.outbound.allowedChannels).toEqual(['qq', 'wechat']);

    const hash = currentPolicyHash(projectDir);
    const ok = assertPolicyHash(projectDir, hash);
    expect(ok.ok).toBe(true);
  });

  test('rejects missing or mismatched hash', () => {
    const projectDir = tempProjectDir();
    const missing = assertPolicyHash(projectDir, undefined);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe('missing_policy_hash');

    writePolicy(projectDir, { outbound: { burstLimit: 5 } });
    const stale = assertPolicyHash(projectDir, 'bad_hash');
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.reason).toBe('policy_hash_mismatch');
  });
});

