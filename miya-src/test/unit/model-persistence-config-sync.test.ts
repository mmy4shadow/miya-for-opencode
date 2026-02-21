import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  persistAgentRuntimeFromConfigSnapshot,
  readPersistedAgentRuntime,
} from '../../src/config/agent-model-persistence';

describe('model persistence config sync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-config-sync-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('persists multi-agent runtime config from opencode snapshot', () => {
    const result = persistAgentRuntimeFromConfigSnapshot(tempDir, {
      defaultAgent: '2-code-search',
      agent: {
        '2-code-search': {
          model: 'openai/gpt-5.1-codex-mini',
          providerID: 'openai',
        },
        '5-code-fixer': {
          model: 'opencode/minimax-m2.5-free',
          providerID: 'opencode',
        },
      },
    });

    expect(result.updated).toBeGreaterThan(0);
    const runtime = readPersistedAgentRuntime(tempDir);
    expect(runtime.activeAgentId).toBe('2-code-search');
    expect(runtime.agents['2-code-search']?.model).toBe('openai/gpt-5.1-codex-mini');
    expect(runtime.agents['5-code-fixer']?.model).toBe('opencode/minimax-m2.5-free');
  });
});

