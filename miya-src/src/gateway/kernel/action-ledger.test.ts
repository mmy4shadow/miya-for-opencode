import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendToolActionLedgerEvent,
  listToolActionLedgerEvents,
} from './action-ledger';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-action-ledger-test-'));
}

describe('tool action ledger', () => {
  test('appends immutable chained events', () => {
    const projectDir = tempProjectDir();
    const first = appendToolActionLedgerEvent(projectDir, {
      method: 'sessions.send',
      clientID: 'c1',
      role: 'ui',
      params: { sessionID: 's1', text: 'hello' },
      status: 'completed',
      result: { delivered: true },
    });
    const second = appendToolActionLedgerEvent(projectDir, {
      method: 'sessions.send',
      clientID: 'c1',
      role: 'ui',
      params: { sessionID: 's1', text: 'hello2' },
      status: 'failed',
      error: 'boom',
    });
    expect(first.previousHash).toBe('GENESIS');
    expect(second.previousHash).toBe(first.entryHash);
    expect(first.replayToken.length).toBeGreaterThan(20);
  });

  test('lists most recent ledger rows first', () => {
    const projectDir = tempProjectDir();
    appendToolActionLedgerEvent(projectDir, {
      method: 'alpha',
      clientID: 'c1',
      role: 'admin',
      params: {},
      status: 'completed',
      result: { ok: true },
    });
    appendToolActionLedgerEvent(projectDir, {
      method: 'beta',
      clientID: 'c2',
      role: 'node',
      params: {},
      status: 'completed',
      result: { ok: true },
    });
    const rows = listToolActionLedgerEvents(projectDir, 10);
    expect(rows.length).toBe(2);
    expect(rows[0]?.method).toBe('beta');
    expect(rows[1]?.method).toBe('alpha');
  });
});
