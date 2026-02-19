import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendInteractionEvent,
  readInteractionStats,
} from './interaction-stats';

function tempFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-interaction-stats-'));
  return path.join(dir, 'interaction-stats.json');
}

describe('interaction stats', () => {
  test('aggregates consult and outcome windows', () => {
    const file = tempFilePath();
    const now = Date.now();
    appendInteractionEvent(
      file,
      {
        atMs: now - 10_000,
        type: 'consult',
        userInitiated: false,
        decision: 'allow',
      },
      now,
    );
    appendInteractionEvent(
      file,
      {
        atMs: now - 8_000,
        type: 'consult',
        userInitiated: true,
        decision: 'allow',
      },
      now,
    );
    appendInteractionEvent(
      file,
      {
        atMs: now - 5_000,
        type: 'outcome',
        userInitiated: false,
        delivered: true,
        userReplyWithinSec: 42,
        explicitFeedback: 'positive',
      },
      now,
    );
    const stats = readInteractionStats(file, now);
    expect(stats.window1h.consults).toBe(2);
    expect(stats.window1h.proactiveAllows).toBe(1);
    expect(stats.window24h.delivered).toBe(1);
    expect(stats.window24h.replyRate).toBe(1);
    expect(stats.window24h.userInitiatedRate).toBe(0.5);
    expect(stats.window24h.medianReplySec).toBe(42);
  });
});

