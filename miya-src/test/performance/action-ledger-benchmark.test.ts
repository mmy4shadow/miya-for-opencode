import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendToolActionLedgerEvent,
  listToolActionLedgerEvents,
} from '../../src/gateway/kernel/action-ledger';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-action-ledger-bench-'));
}

test('performance benchmark: append and query 500 ledger events within budget', () => {
  const projectDir = tempProjectDir();
  const start = performance.now();
  for (let i = 0; i < 500; i += 1) {
    appendToolActionLedgerEvent(projectDir, {
      method: 'bench',
      clientID: 'perf',
      role: 'node',
      params: { i, nested: { v: i % 7 } },
      status: 'completed',
      result: { ok: true, i },
    });
  }
  const rows = listToolActionLedgerEvents(projectDir, 1000);
  const elapsedMs = performance.now() - start;

  expect(rows.length).toBe(500);
  expect(elapsedMs).toBeLessThan(12000);
});
