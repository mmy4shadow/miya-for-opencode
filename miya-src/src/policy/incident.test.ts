import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { appendPolicyIncident, listPolicyIncidents } from './incident';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-policy-incident-test-'));
}

describe('policy incidents', () => {
  test('appends and lists incidents in reverse chronological order', () => {
    const projectDir = tempProjectDir();
    const first = appendPolicyIncident(projectDir, {
      type: 'manual_pause',
      reason: 'manual_pause:outbound_send',
    });
    const second = appendPolicyIncident(projectDir, {
      type: 'friend_tier_sensitive_violation',
      reason: 'outbound_blocked:friend_tier_sensitive_content_denied',
      channel: 'qq',
      destination: 'friend-1',
      pausedDomains: ['outbound_send', 'desktop_control'],
      semanticTags: ['recipient_mismatch'],
    });

    const rows = listPolicyIncidents(projectDir, 10);
    expect(rows.length).toBe(2);
    expect(rows.some((row) => row.id === first.id)).toBe(true);
    expect(rows.some((row) => row.id === second.id)).toBe(true);
    const matched = rows.find((row) => row.id === second.id);
    expect(matched?.type).toBe('friend_tier_sensitive_violation');
    expect(matched?.semanticTags).toEqual(['recipient_mismatch']);
  });

  test('rejects non-frozen semantic tags', () => {
    const projectDir = tempProjectDir();
    expect(() =>
      appendPolicyIncident(projectDir, {
        type: 'manual_pause',
        reason: 'bad',
        semanticTags: ['unknown_tag' as any],
      }),
    ).toThrow(/invalid_semantic_tag/);
  });
});
