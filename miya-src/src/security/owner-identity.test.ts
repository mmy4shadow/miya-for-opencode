import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  initOwnerIdentity,
  readOwnerIdentityState,
  updateVoiceprintThresholds,
  verifyOwnerPasswordOnly,
  verifyOwnerSecrets,
} from './owner-identity';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-owner-identity-test-'));
}

describe('owner identity voiceprint thresholds', () => {
  test('initializes with defaults and allows threshold updates', () => {
    const projectDir = tempProjectDir();
    const base = readOwnerIdentityState(projectDir);
    expect(base.voiceprintThresholds.ownerMinScore).toBe(0.78);
    expect(base.voiceprintThresholds.minSampleDurationSec).toBe(2);

    const initialized = initOwnerIdentity(projectDir, {
      password: 'pw-1',
      passphrase: 'phrase-1',
      voiceprintThresholds: {
        ownerMinScore: 0.83,
        farTarget: 0.02,
      },
    });
    expect(initialized.voiceprintThresholds.ownerMinScore).toBe(0.83);
    expect(initialized.voiceprintThresholds.farTarget).toBe(0.02);

    const updated = updateVoiceprintThresholds(projectDir, {
      guestMaxScore: 0.6,
      minSampleDurationSec: 3,
      frrTarget: 0.04,
    });
    expect(updated.voiceprintThresholds.guestMaxScore).toBe(0.6);
    expect(updated.voiceprintThresholds.minSampleDurationSec).toBe(3);
    expect(updated.voiceprintThresholds.frrTarget).toBe(0.04);

    expect(verifyOwnerPasswordOnly(projectDir, 'pw-1')).toBe(true);
    expect(verifyOwnerSecrets(projectDir, { passphrase: 'phrase-1' })).toBe(true);
  });
});
