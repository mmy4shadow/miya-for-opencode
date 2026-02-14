import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  approveOwnerSyncToken,
  consumeOwnerSyncToken,
  detectOwnerSyncTokenFromText,
  issueOwnerSyncToken,
  verifyOwnerSyncToken,
} from './owner-sync';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-owner-sync-test-'));
}

describe('owner sync token flow', () => {
  test('issues approves verifies and consumes token', () => {
    const projectDir = tempProjectDir();
    const issued = issueOwnerSyncToken(projectDir, {
      action: 'outbound.high_risk.send',
      payloadHash: 'abc123',
    });
    expect(issued.token.length).toBeGreaterThan(6);

    const approved = approveOwnerSyncToken(projectDir, {
      token: issued.token,
      channel: 'qq',
      senderID: 'owner-1',
    });
    expect(approved.ok).toBe(true);

    const verified = verifyOwnerSyncToken(projectDir, {
      token: issued.token,
      action: 'outbound.high_risk.send',
      payloadHash: 'abc123',
    });
    expect(verified.ok).toBe(true);

    const consumed = consumeOwnerSyncToken(projectDir, issued.token);
    expect(consumed.ok).toBe(true);

    const replay = verifyOwnerSyncToken(projectDir, {
      token: issued.token,
      action: 'outbound.high_risk.send',
      payloadHash: 'abc123',
    });
    expect(replay.ok).toBe(false);
  });

  test('detects owner sync token from confirmation text', () => {
    expect(detectOwnerSyncTokenFromText('同意 OSABC12345')).toBe('OSABC12345');
    expect(detectOwnerSyncTokenFromText('/miya confirm osabc12345')).toBe('OSABC12345');
    expect(detectOwnerSyncTokenFromText('随便聊聊')).toBeNull();
  });
});

