import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getContactTier,
  listContactTiers,
  setContactTier,
  upsertChannelState,
} from './pairing-store';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-channel-pairing-store-'));
}

describe('channel contact tier store', () => {
  test('sets and reads contact tier while ensuring allowlist', () => {
    const projectDir = tempProjectDir();
    upsertChannelState(projectDir, 'qq', { allowlist: [] });

    setContactTier(projectDir, 'qq', 'user-a', 'owner');
    expect(getContactTier(projectDir, 'qq', 'user-a')).toBe('owner');
  });

  test('returns null when sender is not allowlisted', () => {
    const projectDir = tempProjectDir();
    upsertChannelState(projectDir, 'wechat', { allowlist: [] });

    expect(getContactTier(projectDir, 'wechat', 'nope')).toBeNull();
  });

  test('lists allowlisted contacts with effective tier', () => {
    const projectDir = tempProjectDir();
    upsertChannelState(projectDir, 'qq', { allowlist: ['user-f'] });
    setContactTier(projectDir, 'wechat', 'user-o', 'owner');

    const rows = listContactTiers(projectDir);
    expect(rows).toContainEqual({
      channel: 'qq',
      senderID: 'user-f',
      tier: 'friend',
    });
    expect(rows).toContainEqual({
      channel: 'wechat',
      senderID: 'user-o',
      tier: 'owner',
    });
  });

  test('encrypts account identifiers at rest', () => {
    const projectDir = tempProjectDir();
    setContactTier(projectDir, 'qq', 'acc-123456', 'owner');
    const raw = fs.readFileSync(
      path.join(projectDir, '.opencode', 'miya', 'channels.json'),
      'utf-8',
    );
    expect(raw.includes('acc-123456')).toBe(false);
    expect(raw.includes('miya-sec:')).toBe(true);
  });
});
