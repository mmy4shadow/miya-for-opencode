import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensurePairRequest,
  isSenderAllowed,
  listPairRequests,
  resolvePairRequest,
  upsertChannelState,
} from './pairing-store';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-channel-test-'));
}

describe('channel pairing store', () => {
  test('creates and resolves pair requests', () => {
    const projectDir = tempProjectDir();
    upsertChannelState(projectDir, 'telegram', {
      enabled: true,
      connected: true,
    });

    const pair = ensurePairRequest(projectDir, {
      channel: 'telegram',
      senderID: 'u1',
      displayName: 'User One',
      messagePreview: 'hello',
    });

    expect(pair.status).toBe('pending');
    expect(listPairRequests(projectDir, 'pending').length).toBe(1);

    const approved = resolvePairRequest(projectDir, pair.id, 'approved');
    expect(approved?.status).toBe('approved');
    expect(isSenderAllowed(projectDir, 'telegram', 'u1')).toBe(true);
  });

  test('avoids duplicate pending pair request', () => {
    const projectDir = tempProjectDir();
    const first = ensurePairRequest(projectDir, {
      channel: 'slack',
      senderID: 'U123',
      messagePreview: 'ping',
    });
    const second = ensurePairRequest(projectDir, {
      channel: 'slack',
      senderID: 'U123',
      messagePreview: 'ping again',
    });

    expect(first.id).toBe(second.id);
    expect(listPairRequests(projectDir, 'pending').length).toBe(1);
  });
});
