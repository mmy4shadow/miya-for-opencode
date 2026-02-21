import { describe, expect, test } from 'vitest';
import { createSlashCommandBridgeHook } from './index';

describe('createSlashCommandBridgeHook', () => {
  test('rewrites /miya-gateway-start to direct tool-call template', async () => {
    const hook = createSlashCommandBridgeHook();
    const output = {
      messages: [
        {
          info: { role: 'user', agent: '1-task-manager' },
          parts: [{ type: 'text', text: '/miya-gateway-start' }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);

    const text = String(output.messages[0]?.parts[0]?.text ?? '');
    expect(text).toContain('[MIYA COMMAND BRIDGE]');
    expect(text).toContain('miya_gateway_start');
  });

  test('does not rewrite unrelated slash commands', async () => {
    const hook = createSlashCommandBridgeHook();
    const output = {
      messages: [
        {
          info: { role: 'user', agent: '1-task-manager' },
          parts: [{ type: 'text', text: '/help' }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);

    expect(output.messages[0]?.parts[0]?.text).toBe('/help');
  });
});
