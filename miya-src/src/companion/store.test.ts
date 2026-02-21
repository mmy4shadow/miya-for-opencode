import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  confirmCompanionMemoryVector,
  listPendingCompanionMemoryVectors,
} from './memory-vector';
import {
  addCompanionAsset,
  addCompanionMemoryFact,
  patchCompanionProfile,
  readCompanionProfile,
  resetCompanionProfile,
  syncCompanionProfileMemoryFacts,
} from './store';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-companion-test-'));
}

describe('companion profile store', () => {
  test('updates profile, memory and assets', () => {
    const projectDir = tempProjectDir();
    const profile = patchCompanionProfile(projectDir, {
      enabled: true,
      onboardingCompleted: true,
      name: 'Miya',
      persona: 'playful',
      relationship: 'girlfriend',
      style: 'romantic',
    });
    expect(profile.enabled).toBe(true);

    const withMemory = addCompanionMemoryFact(
      projectDir,
      'User likes synthwave music.',
    );
    expect(withMemory.memoryFacts.length).toBe(0);
    const pending = listPendingCompanionMemoryVectors(projectDir);
    expect(pending.length).toBe(1);
    confirmCompanionMemoryVector(projectDir, {
      memoryID: pending[0].id,
      confirm: true,
    });
    const synced = syncCompanionProfileMemoryFacts(projectDir);
    expect(synced.memoryFacts.length).toBe(1);

    const withAsset = addCompanionAsset(projectDir, {
      type: 'image',
      pathOrUrl: '/tmp/ref.png',
      label: 'reference',
    });
    expect(withAsset.assets.length).toBe(1);
    expect(readCompanionProfile(projectDir).assets[0]?.type).toBe('image');

    const reset = resetCompanionProfile(projectDir);
    expect(reset.enabled).toBe(false);
    expect(reset.memoryFacts.length).toBe(0);
  });
});
