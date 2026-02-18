import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  adjustFastBrain,
  fastBrainBucket,
  readFastBrainScore,
  touchFastBrain,
} from './bandit';

function tempFastBrainPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-psyche-bandit-'));
  return path.join(dir, 'fast-brain.json');
}

describe('psyche bandit store', () => {
  test('builds stable bucket key', () => {
    const key = fastBrainBucket({
      state: 'FOCUS',
      intent: ' outbound.send.qq ',
      urgency: 'medium',
      channel: 'QQ',
      userInitiated: true,
    });
    expect(key).toBe(
      'state=FOCUS|intent=outbound.send.qq|urgency=medium|channel=qq|user=1',
    );
  });

  test('updates approval and reward score', () => {
    const file = tempFastBrainPath();
    const input = {
      state: 'CONSUME' as const,
      intent: 'daily.checkin',
      urgency: 'low' as const,
      channel: 'wechat',
      userInitiated: false,
    };
    const score0 = readFastBrainScore(file, input);
    expect(score0).toBe(0.5);

    touchFastBrain(file, { ...input, approved: true });
    const score1 = readFastBrainScore(file, input);
    expect(score1).toBeGreaterThan(0.5);

    const key = fastBrainBucket(input);
    adjustFastBrain(file, key, 0, 2);
    const score2 = readFastBrainScore(file, input);
    expect(score2).toBeLessThan(score1);
  });
});
