import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  appendVoiceHistory,
  clearVoiceHistory,
  patchVoiceState,
  readVoiceState,
} from './state';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-voice-test-'));
}

describe('voice state', () => {
  test('patches state and persists history', () => {
    const projectDir = tempProjectDir();
    const patched = patchVoiceState(projectDir, {
      enabled: true,
      wakeWordEnabled: true,
      talkMode: true,
      routeSessionID: 'main',
    });
    expect(patched.enabled).toBe(true);

    const item = appendVoiceHistory(projectDir, {
      text: 'hello miya',
      source: 'wake',
    });
    expect(item.id.startsWith('voice_')).toBe(true);
    expect(readVoiceState(projectDir).history.length).toBe(1);

    const cleared = clearVoiceHistory(projectDir);
    expect(cleared.history.length).toBe(0);
  });
});
