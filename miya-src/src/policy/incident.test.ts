import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
    });

    const rows = listPolicyIncidents(projectDir, 10);
    expect(rows.length).toBe(2);
    expect(rows[0].id).toBe(second.id);
    expect(rows[1].id).toBe(first.id);
    expect(rows[0].type).toBe('friend_tier_sensitive_violation');
  });
});
