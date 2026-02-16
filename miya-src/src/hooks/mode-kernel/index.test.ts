import { describe, expect, test } from 'bun:test';
import { createModeKernelHook } from './index';

describe('mode kernel hook', () => {
  test('injects mode kernel metadata block', async () => {
    const hook = createModeKernelHook();
    const output = {
      messages: [
        {
          info: { role: 'user', sessionID: 'main' },
          parts: [{ type: 'text', text: '请帮我修复这个 TypeError 报错' }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);
    const text = String(output.messages[0]?.parts[0]?.text ?? '');
    expect(text).toContain('[MIYA_MODE_KERNEL v1]');
    expect(text).toContain('mode=work');
  });

  test('applies low-confidence safe fallback to work mode', async () => {
    const hook = createModeKernelHook({
      minConfidenceForSafeMode: 0.99,
    });
    const output = {
      messages: [
        {
          info: { role: 'user', sessionID: 'main' },
          parts: [{ type: 'text', text: 'hello there' }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);
    const text = String(output.messages[0]?.parts[0]?.text ?? '');
    expect(text).toContain('mode=work');
    expect(text).toContain('safety_fallback=mode:work');
  });
});
