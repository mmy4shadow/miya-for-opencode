import { describe, expect, test } from 'bun:test';
import { createPsycheToneHook } from './index';

describe('psyche tone hook', () => {
  test('injects tone style in chat mode', async () => {
    const hook = createPsycheToneHook();
    const output = {
      messages: [
        {
          info: { role: 'user', sessionID: 'main' },
          parts: [
            {
              type: 'text',
              text: '[MIYA_MODE_KERNEL v1]\nmode=chat\nconfidence=0.770\nwhy=text_signal=chat\n[/MIYA_MODE_KERNEL]\n\n---\n\n我今天很焦虑，想聊聊',
            },
          ],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);
    const text = String(output.messages[0]?.parts[0]?.text ?? '');
    expect(text).toContain('[MIYA_PSYCHE_TONE v1]');
    expect(text).toContain('mode=chat');
    expect(text).toContain('tone=supportive');
  });

  test('skips injection in work mode', async () => {
    const hook = createPsycheToneHook();
    const output = {
      messages: [
        {
          info: { role: 'user', sessionID: 'main' },
          parts: [
            {
              type: 'text',
              text: '[MIYA_MODE_KERNEL v1]\nmode=work\nconfidence=0.880\nwhy=text_signal=work\n[/MIYA_MODE_KERNEL]\n\n---\n\n修复 TypeError',
            },
          ],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);
    const text = String(output.messages[0]?.parts[0]?.text ?? '');
    expect(text).not.toContain('[MIYA_PSYCHE_TONE v1]');
  });
});
