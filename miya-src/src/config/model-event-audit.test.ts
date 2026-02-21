import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  appendModelEventAudit,
  shouldAuditModelEvent,
} from './model-event-audit';

describe('model-event-audit', () => {
  test('captures only model-related event types', () => {
    expect(shouldAuditModelEvent({ type: 'settings.saved' })).toBe(true);
    expect(shouldAuditModelEvent({ type: 'agent.changed' })).toBe(true);
    expect(
      shouldAuditModelEvent({
        type: 'message.updated',
        properties: {
          selectedAgent: '5-code-fixer',
          model: 'openrouter/z-ai/glm-5',
        },
      }),
    ).toBe(true);
    expect(
      shouldAuditModelEvent({
        type: 'message.updated',
        properties: { info: { role: 'user' } },
      }),
    ).toBe(false);
    expect(shouldAuditModelEvent({ type: '' })).toBe(false);
    expect(shouldAuditModelEvent(null)).toBe(false);
  });

  test('redacts sensitive values in raw frame audit', () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'miya-model-event-audit-'),
    );
    try {
      appendModelEventAudit(projectDir, {
        event: {
          type: 'settings.saved',
          properties: {
            patch: {
              set: {
                'provider.openrouter.options.apiKey': 'sk-123',
                'provider.openrouter.options.baseURL':
                  'https://example.local/v1',
              },
            },
          },
        },
        selections: [],
      });

      const file = path.join(
        projectDir,
        '.opencode',
        'miya',
        'audit',
        'model-event-frames.jsonl',
      );
      const lines = fs
        .readFileSync(file, 'utf-8')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);
      expect(lines.length).toBe(1);
      const row = JSON.parse(lines[0]) as {
        event?: {
          properties?: { patch?: { set?: Record<string, unknown> } };
        };
      };
      expect(
        row.event?.properties?.patch?.set?.[
          'provider.openrouter.options.apiKey'
        ],
      ).toBe('[redacted]');
      expect(
        row.event?.properties?.patch?.set?.[
          'provider.openrouter.options.baseURL'
        ],
      ).toBe('https://example.local/v1');
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
