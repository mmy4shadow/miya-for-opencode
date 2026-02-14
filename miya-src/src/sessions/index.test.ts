import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { enqueueSessionMessage, getSession, upsertSession } from './index';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-session-store-test-'));
}

describe('session store encryption', () => {
  test('encrypts session summary fields at rest and keeps read API plain', () => {
    const projectDir = tempProjectDir();
    upsertSession(projectDir, {
      id: 's-1',
      groupId: 'channel:alice',
      title: 'Alice DM',
      routingSessionID: 'opencode-session-1',
    });
    enqueueSessionMessage(projectDir, 's-1', {
      text: 'summary: latest context',
      source: 'unit',
    });

    const file = path.join(projectDir, '.opencode', 'miya', 'sessions.json');
    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw.includes('channel:alice')).toBe(false);
    expect(raw.includes('latest context')).toBe(false);
    expect(raw.includes('miya-sec:')).toBe(true);

    const session = getSession(projectDir, 's-1');
    expect(session?.groupId).toBe('channel:alice');
    expect(session?.queue[0]?.text).toContain('latest context');
  });
});
