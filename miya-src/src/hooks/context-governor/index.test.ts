import { describe, expect, test } from 'bun:test';
import { createContextGovernorHook } from './index';

describe('context governor hook', () => {
  test('truncates oversized tool output and adds compact marker', async () => {
    const hook = createContextGovernorHook({
      enabled: true,
      toolOutputMaxChars: 1200,
      toolOutputHeadChars: 500,
      toolOutputTailChars: 400,
    });
    const output = { output: `HEAD-${'x'.repeat(5000)}-TAIL` };

    await hook['tool.execute.after'](
      { tool: 'websearch', sessionID: 's1' },
      output,
    );

    expect(output.output.includes('MIYA_OUTPUT_TRUNCATED')).toBe(true);
    expect(output.output.includes('hint="narrow scope')).toBe(true);
  });

  test('injects compact retained context for recent tool records', async () => {
    let current = 1_000_000;
    const hook = createContextGovernorHook(
      {
        enabled: true,
        maxInjectedRecords: 2,
      },
      { now: () => current },
    );

    await hook['tool.execute.after'](
      { tool: 'grep', sessionID: 'main' },
      { output: 'found TODO in src/core/router.ts and src/hooks/index.ts' },
    );
    current += 1_000;
    await hook['tool.execute.after'](
      { tool: 'lsp_find_references', sessionID: 'main' },
      { output: 'symbol references: router, scheduler, task manager' },
    );

    const payload = {
      messages: [
        {
          info: { role: 'user', sessionID: 'main' },
          parts: [
            { type: 'text', text: 'please fix router and task manager issues' },
          ],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, payload);
    const text = String(payload.messages[0]?.parts[0]?.text ?? '');
    expect(text.includes('[MIYA CONTEXT GOVERNOR]')).toBe(true);
    expect(text.includes('tool=grep')).toBe(true);
    expect(text.includes('tool=lsp_find_references')).toBe(true);
  });

  test('skips injection for slash command bridge payload', async () => {
    const hook = createContextGovernorHook({ enabled: true });
    await hook['tool.execute.after'](
      { tool: 'read', sessionID: 'bridge' },
      { output: 'sample' },
    );

    const payload = {
      messages: [
        {
          info: { role: 'user', sessionID: 'bridge' },
          parts: [{ type: 'text', text: '[MIYA COMMAND BRIDGE]\ncall tool' }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, payload);
    expect(payload.messages[0]?.parts[0]?.text).toBe(
      '[MIYA COMMAND BRIDGE]\ncall tool',
    );
  });
});
