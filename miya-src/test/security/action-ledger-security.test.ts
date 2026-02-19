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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-action-ledger-security-'));
}

describe('action ledger security', () => {
  test('hashes full params payload instead of lossy summary', () => {
    const projectDir = tempProjectDir();
    const a = appendToolActionLedgerEvent(projectDir, {
      method: 'automation.run',
      clientID: 'c1',
      role: 'ui',
      params: { alpha: null },
      status: 'completed',
      result: { ok: true },
    });
    const b = appendToolActionLedgerEvent(projectDir, {
      method: 'automation.run',
      clientID: 'c1',
      role: 'ui',
      params: { beta: null },
      status: 'completed',
      result: { ok: true },
    });
    expect(a.inputHash).not.toBe(b.inputHash);
  });

  test('uses generated per-project replay secret when env secret is absent', () => {
    const projectDir = tempProjectDir();
    appendToolActionLedgerEvent(projectDir, {
      method: 'sessions.send',
      clientID: 'c2',
      role: 'admin',
      params: { text: 'hello' },
      status: 'completed',
      result: { ok: true },
    });
    const secretPath = path.join(
      getMiyaRuntimeDir(projectDir),
      'audit',
      'tool-action-ledger.secret',
    );
    expect(fs.existsSync(secretPath)).toBeTrue();
    const secret = fs.readFileSync(secretPath, 'utf-8').trim();
    expect(secret.length).toBeGreaterThanOrEqual(64);
  });

  test('detects tampered ledger rows via hash-chain verification', () => {
    const projectDir = tempProjectDir();
    appendToolActionLedgerEvent(projectDir, {
      method: 'sessions.send',
      clientID: 'c3',
      role: 'ui',
      params: { text: 'one' },
      status: 'completed',
      result: { ok: true },
    });
    appendToolActionLedgerEvent(projectDir, {
      method: 'sessions.send',
      clientID: 'c3',
      role: 'ui',
      params: { text: 'two' },
      status: 'completed',
      result: { ok: true },
    });

    const ledgerPath = path.join(
      getMiyaRuntimeDir(projectDir),
      'audit',
      'tool-action-ledger.jsonl',
    );
    const rows = fs.readFileSync(ledgerPath, 'utf-8').trimEnd().split(/\r?\n/);
    const first = JSON.parse(rows[0] ?? '{}') as Record<string, string>;
    first.approvalBasis = 'forged';
    rows[0] = JSON.stringify(first);
    fs.writeFileSync(ledgerPath, `${rows.join('\n')}\n`, 'utf-8');

    const report = verifyToolActionLedger(projectDir);
    expect(report.ok).toBeFalse();
    expect(report.issues.some((issue) => issue.reason === 'entry_hash_mismatch')).toBeTrue();
    expect(listToolActionLedgerEvents(projectDir, 10).length).toBe(2);
  });
});
