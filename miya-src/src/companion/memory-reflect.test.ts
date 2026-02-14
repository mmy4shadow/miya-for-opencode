import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listPendingCompanionMemoryVectors } from './memory-vector';
import {
  appendShortTermMemoryLog,
  maybeAutoReflectCompanionMemory,
  maybeReflectOnSessionEnd,
  reflectCompanionMemory,
} from './memory-reflect';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-reflect-test-'));
}

describe('companion memory reflect', () => {
  test('consolidates short-term logs into pending memory vectors and archives source logs', () => {
    const projectDir = tempProjectDir();
    appendShortTermMemoryLog(projectDir, {
      sessionID: 's1',
      sender: 'user',
      text: '我喜欢无糖可乐',
    });
    appendShortTermMemoryLog(projectDir, {
      sessionID: 's1',
      sender: 'user',
      text: '我不喜欢太甜的咖啡',
    });

    const result = reflectCompanionMemory(projectDir, { force: true });
    expect(result.processedLogs).toBe(2);
    expect(result.generatedTriplets).toBeGreaterThanOrEqual(2);
    expect(result.createdMemories.length).toBeGreaterThanOrEqual(2);

    const pending = listPendingCompanionMemoryVectors(projectDir);
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.some((item) => item.text.includes('likes'))).toBe(true);
    expect(pending.some((item) => item.text.includes('dislikes'))).toBe(true);
  });

  test('deduplicates short-term logs by message hash', () => {
    const projectDir = tempProjectDir();
    const first = appendShortTermMemoryLog(projectDir, {
      sessionID: 's1',
      sender: 'user',
      text: '我喜欢 TypeScript',
      at: '2026-02-14T00:00:00.000Z',
      messageID: 'same-hash',
    });
    const duplicate = appendShortTermMemoryLog(projectDir, {
      sessionID: 's1',
      sender: 'user',
      text: '我喜欢 TypeScript',
      at: '2026-02-14T00:00:00.000Z',
      messageID: 'same-hash',
    });
    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
  });

  test('auto reflect requires idle + threshold', () => {
    const projectDir = tempProjectDir();
    for (let i = 0; i < 51; i += 1) {
      appendShortTermMemoryLog(projectDir, {
        sessionID: 's2',
        sender: 'user',
        text: `我喜欢功能 ${i}`,
        at: '2026-02-13T00:00:00.000Z',
      });
    }
    const reflected = maybeAutoReflectCompanionMemory(projectDir, {
      idleMinutes: 10,
      minPendingLogs: 50,
      maxLogs: 60,
      cooldownMinutes: 1,
    });
    expect(reflected).not.toBeNull();
    expect(reflected?.processedLogs).toBe(51);

    const blockedByCooldown = maybeAutoReflectCompanionMemory(projectDir, {
      idleMinutes: 10,
      minPendingLogs: 1,
      maxLogs: 60,
      cooldownMinutes: 10,
    });
    expect(blockedByCooldown).toBeNull();
  });

  test('session-end reflect triggers when pending logs reach threshold', () => {
    const projectDir = tempProjectDir();
    for (let i = 0; i < 50; i += 1) {
      appendShortTermMemoryLog(projectDir, {
        sessionID: 's3',
        sender: 'user',
        text: `我喜欢会话结束整理 ${i}`,
      });
    }
    const reflected = maybeReflectOnSessionEnd(projectDir, {
      minPendingLogs: 50,
      maxLogs: 100,
    });
    expect(reflected).not.toBeNull();
    expect(reflected?.processedLogs).toBe(50);
  });
});
