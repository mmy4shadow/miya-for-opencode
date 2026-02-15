import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getTrustScore, trustTierFromScore, updateTrustScore } from './trust';

function tempTrustFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-psyche-trust-'));
  return path.join(dir, 'trust.json');
}

describe('psyche trust score', () => {
  test('uses default score for unknown entity', () => {
    const file = tempTrustFile();
    expect(getTrustScore(file, { kind: 'target', value: 'qq:owner' })).toBe(50);
  });

  test('increases score on approved and decreases on denied', () => {
    const file = tempTrustFile();
    const approved = updateTrustScore(file, {
      kind: 'target',
      value: 'qq:owner',
      approved: true,
      confidence: 0.95,
    });
    const denied = updateTrustScore(file, {
      kind: 'target',
      value: 'qq:owner',
      approved: false,
      confidence: 0.95,
    });
    expect(approved.score).toBe(55);
    expect(denied.score).toBe(47);
  });

  test('drops score on low confidence evidence and high risk rollback', () => {
    const file = tempTrustFile();
    const lowConfidence = updateTrustScore(file, {
      kind: 'action',
      value: 'outbound.send.qq',
      approved: true,
      confidence: 0.3,
    });
    const rollback = updateTrustScore(file, {
      kind: 'action',
      value: 'outbound.send.qq',
      approved: false,
      confidence: 0.9,
      highRiskRollback: true,
    });
    expect(lowConfidence.score).toBe(45);
    expect(rollback.score).toBe(20);
  });

  test('maps trust tier by score', () => {
    expect(trustTierFromScore(95)).toBe('high');
    expect(trustTierFromScore(60)).toBe('medium');
    expect(trustTierFromScore(12)).toBe('low');
  });
});
