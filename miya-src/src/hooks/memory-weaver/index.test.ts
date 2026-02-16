import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { upsertCompanionMemoryVector } from '../../companion/memory-vector';
import { createMemoryWeaverHook } from './index';

function createTempProjectDir(): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-memory-weaver-hook-test-'));
  fs.mkdirSync(path.join(projectDir, '.opencode', 'miya'), { recursive: true });
  return projectDir;
}

describe('memory weaver hook', () => {
  test('injects work memory only in work mode', async () => {
    const projectDir = createTempProjectDir();
    upsertCompanionMemoryVector(projectDir, {
      text: '项目使用 bun test 执行单测',
      domain: 'work',
      source: 'test',
      activate: true,
      confidence: 0.9,
    });
    upsertCompanionMemoryVector(projectDir, {
      text: '用户偏好称呼为宝贝',
      domain: 'relationship',
      source: 'test',
      activate: true,
      confidence: 0.9,
    });

    const hook = createMemoryWeaverHook(projectDir);
    const output = {
      messages: [
        {
          info: { role: 'user', sessionID: 'main' },
          parts: [
            {
              type: 'text',
              text:
                '[MIYA_MODE_KERNEL v1]\nmode=work\nconfidence=0.810\nwhy=text_signal=work\n[/MIYA_MODE_KERNEL]\n\n---\n\n请帮我处理 bun test 失败问题',
            },
          ],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);
    const text = String(output.messages[0]?.parts[0]?.text ?? '');
    expect(text).toContain('[MIYA_MEMORY_CONTEXT v1 reference_only=1]');
    expect(text).toContain('[work]');
    expect(text).not.toContain('[relationship]');
  });
});
