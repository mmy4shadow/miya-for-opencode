import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../src/workflow';
import {
  appendToolActionLedgerEvent,
  listToolActionLedgerEvents,
  verifyToolActionLedger,
} from '../../src/gateway/kernel/action-ledger';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-action-ledger-resilience-'));
}

describe('action ledger disaster recovery and resilience', () => {
  test('keeps append/list available when historical rows are malformed', () => {
    const projectDir = tempProjectDir();
    appendToolActionLedgerEvent(projectDir, {
      method: 'alpha',
      clientID: 'c1',
      role: 'node',
      params: { a: 1 },
      status: 'completed',
      result: { ok: true },
    });

    const ledgerPath = path.join(
      getMiyaRuntimeDir(projectDir),
      'audit',
      'tool-action-ledger.jsonl',
    );
    fs.appendFileSync(ledgerPath, '{bad-json-line}\n', 'utf-8');

    appendToolActionLedgerEvent(projectDir, {
      method: 'beta',
      clientID: 'c2',
      role: 'node',
      params: { b: 2 },
      status: 'completed',
      result: { ok: true },
    });

    const rows = listToolActionLedgerEvents(projectDir, 10);
    expect(rows.length).toBe(2);
    expect(rows[0]?.method).toBe('beta');
    expect(rows[1]?.method).toBe('alpha');
  });

  test('verification report marks malformed rows for recovery workflow', () => {
    const projectDir = tempProjectDir();
    appendToolActionLedgerEvent(projectDir, {
      method: 'gamma',
      clientID: 'c3',
      role: 'ui',
      params: {},
      status: 'completed',
      result: { ok: true },
    });

    const ledgerPath = path.join(
      getMiyaRuntimeDir(projectDir),
      'audit',
      'tool-action-ledger.jsonl',
    );
    fs.appendFileSync(ledgerPath, '{not-json}\n', 'utf-8');

    const report = verifyToolActionLedger(projectDir);
    expect(report.ok).toBeFalse();
    expect(report.issues.some((issue) => issue.reason === 'malformed_json')).toBeTrue();
  });
});
