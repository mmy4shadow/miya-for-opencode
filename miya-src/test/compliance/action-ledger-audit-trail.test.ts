import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../src/workflow';
import {
  appendToolActionLedgerEvent,
  verifyToolActionLedger,
} from '../../src/gateway/kernel/action-ledger';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-action-ledger-compliance-'));
}

describe('compliance and audit trail', () => {
  test('ledger chain verifies as compliant under normal append flow', () => {
    const projectDir = tempProjectDir();
    appendToolActionLedgerEvent(projectDir, {
      method: 'sessions.send',
      clientID: 'c1',
      role: 'ui',
      params: { text: 'a' },
      status: 'completed',
      result: { ok: true },
    });
    appendToolActionLedgerEvent(projectDir, {
      method: 'sessions.send',
      clientID: 'c1',
      role: 'ui',
      params: { text: 'b' },
      status: 'failed',
      error: 'boom',
    });
    const report = verifyToolActionLedger(projectDir);
    expect(report.ok).toBeTrue();
    expect(report.valid).toBe(2);
  });

  test('ledger verification catches previous-hash discontinuity', () => {
    const projectDir = tempProjectDir();
    appendToolActionLedgerEvent(projectDir, {
      method: 'x',
      clientID: 'cx',
      role: 'admin',
      params: {},
      status: 'completed',
      result: { ok: true },
    });
    appendToolActionLedgerEvent(projectDir, {
      method: 'y',
      clientID: 'cy',
      role: 'admin',
      params: {},
      status: 'completed',
      result: { ok: true },
    });

    const ledgerPath = path.join(
      getMiyaRuntimeDir(projectDir),
      'audit',
      'tool-action-ledger.jsonl',
    );
    const rows = fs.readFileSync(ledgerPath, 'utf-8').trimEnd().split(/\r?\n/);
    const second = JSON.parse(rows[1] ?? '{}') as Record<string, string>;
    second.previousHash = 'BROKEN';
    rows[1] = JSON.stringify(second);
    fs.writeFileSync(ledgerPath, `${rows.join('\n')}\n`, 'utf-8');

    const report = verifyToolActionLedger(projectDir);
    expect(report.ok).toBeFalse();
    expect(report.issues.some((issue) => issue.reason.includes('previous_hash_mismatch'))).toBeTrue();
  });
});
