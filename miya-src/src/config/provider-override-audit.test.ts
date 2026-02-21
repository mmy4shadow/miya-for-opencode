import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  appendProviderOverrideAudit,
  listProviderOverrideAudits,
} from './provider-override-audit';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-provider-audit-'));
}

describe('provider override audit', () => {
  test('appends and lists records in reverse chronological order', () => {
    const projectDir = tempProjectDir();
    appendProviderOverrideAudit(projectDir, {
      source: 'settings.save',
      agentName: '6-ui-designer',
      model: 'openai/gpt-5',
      providerID: 'openai',
      activeAgentId: '6-ui-designer',
      hasApiKey: true,
      hasBaseURL: true,
      optionKeys: ['timeoutMs', 'baseURL'],
    });
    appendProviderOverrideAudit(projectDir, {
      source: 'message.updated',
      agentName: '2-code-search',
      model: 'openai/gpt-5-mini',
      providerID: 'openai',
      activeAgentId: '2-code-search',
      hasApiKey: false,
      hasBaseURL: true,
      optionKeys: ['baseURL'],
    });

    const rows = listProviderOverrideAudits(projectDir, 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.source).toBe('message.updated');
    expect(rows[0]?.agentName).toBe('2-code-search');
    expect(rows[1]?.source).toBe('settings.save');
    expect(rows[1]?.optionKeys).toEqual(['baseURL', 'timeoutMs']);
  });

  test('enforces list limit', () => {
    const projectDir = tempProjectDir();
    for (let index = 0; index < 8; index += 1) {
      appendProviderOverrideAudit(projectDir, {
        source: `source-${index}`,
        agentName: '1-task-manager',
        providerID: 'google',
        hasApiKey: false,
        hasBaseURL: false,
        optionKeys: [],
      });
    }
    const rows = listProviderOverrideAudits(projectDir, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.source).toBe('source-7');
    expect(rows[2]?.source).toBe('source-5');
  });
});
