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

  test('rotates ledger file when size exceeds configured threshold', () => {
    const previousMax = process.env.MIYA_ACTION_LEDGER_ROTATE_MAX_BYTES;
    const previousKeep = process.env.MIYA_ACTION_LEDGER_ROTATE_KEEP;
    process.env.MIYA_ACTION_LEDGER_ROTATE_MAX_BYTES = '1024';
    process.env.MIYA_ACTION_LEDGER_ROTATE_KEEP = '2';
    const projectDir = tempProjectDir();
    try {
      for (let index = 0; index < 40; index += 1) {
        appendToolActionLedgerEvent(projectDir, {
          method: 'bulk.write',
          clientID: `c${index}`,
          role: 'admin',
          params: {
            sessionID: `s-${index}`,
            text: `payload-${index}-${'x'.repeat(120)}`,
          },
          status: 'completed',
          result: { ok: true, index },
        });
      }
      const file = path.join(
        projectDir,
        '.opencode',
        'miya',
        'audit',
        'tool-action-ledger.jsonl',
      );
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.existsSync(`${file}.1`)).toBe(true);
    } finally {
      if (previousMax === undefined)
        delete process.env.MIYA_ACTION_LEDGER_ROTATE_MAX_BYTES;
      else process.env.MIYA_ACTION_LEDGER_ROTATE_MAX_BYTES = previousMax;
      if (previousKeep === undefined)
        delete process.env.MIYA_ACTION_LEDGER_ROTATE_KEEP;
      else process.env.MIYA_ACTION_LEDGER_ROTATE_KEEP = previousKeep;
    }
  });
});
