import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyPersistedAgentModelOverrides,
  extractAgentModelSelectionFromEvent,
  extractAgentModelSelectionsFromEvent,
  normalizeAgentName,
  normalizeModelRef,
  persistAgentModelSelection,
  persistAgentRuntimeSelection,
  readPersistedAgentModels,
  readPersistedAgentRuntime,
} from './agent-model-persistence';

describe('agent-model-persistence', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-agent-models-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('normalizes agent aliases and model refs', () => {
    expect(normalizeAgentName('explorer')).toBe('2-code-search');
    expect(normalizeAgentName('2-code-search')).toBe('2-code-search');
    expect(normalizeAgentName('unknown-agent')).toBeNull();

    expect(normalizeModelRef('openai/gpt-5.2-codex')).toBe(
      'openai/gpt-5.2-codex',
    );
    expect(
      normalizeModelRef({
        providerID: 'openai',
        modelID: 'gpt-5.1-codex-mini',
      }),
    ).toBe('openai/gpt-5.1-codex-mini');
    expect(normalizeModelRef('invalid-model')).toBeNull();
  });

  test('persists and reads per-agent model selections', () => {
    const changed = persistAgentModelSelection(
      tempDir,
      'explorer',
      'openai/gpt-5.1-codex-mini',
    );
    expect(changed).toBe(true);

    // Invalid payload should be ignored and keep existing data unchanged.
    const invalid = persistAgentModelSelection(tempDir, 'oracle', 'invalid-model');
    expect(invalid).toBe(false);

    expect(readPersistedAgentModels(tempDir)).toEqual({
      '2-code-search': 'openai/gpt-5.1-codex-mini',
    });
  });

  test('applies persisted models as highest-priority agent overrides', () => {
    persistAgentModelSelection(tempDir, '6-ui-designer', 'google/gemini-2.5-pro');
    persistAgentModelSelection(tempDir, 'orchestrator', 'openai/gpt-5.3-codex');

    const merged = applyPersistedAgentModelOverrides(
      {
        agents: {
          '1-task-manager': { model: 'kimi-for-coding/k2p5', temperature: 0.1 },
          '6-ui-designer': { temperature: 0.7 },
        },
      },
      tempDir,
    );

    expect(merged.agents?.['1-task-manager']?.model).toBe('openai/gpt-5.3-codex');
    expect(merged.agents?.['1-task-manager']?.temperature).toBe(0.1);
    expect(merged.agents?.['6-ui-designer']?.model).toBe('google/gemini-2.5-pro');
    expect(merged.agents?.['6-ui-designer']?.temperature).toBe(0.7);
  });

  test('persists runtime fields with revision and active agent', () => {
    const changed = persistAgentRuntimeSelection(tempDir, {
      agentName: '6-ui-designer',
      model: 'openai/gpt-5.2-codex',
      providerID: 'openai',
      options: { baseURL: 'https://api.example.com/v1' },
      apiKey: '{env:OPENAI_API_KEY}',
      baseURL: 'https://api.example.com/v1',
      activeAgentId: '6-ui-designer',
    });
    expect(changed).toBe(true);

    const runtime = readPersistedAgentRuntime(tempDir);
    expect(runtime.revision).toBe(1);
    expect(runtime.activeAgentId).toBe('6-ui-designer');
    expect(runtime.agents['6-ui-designer']?.providerID).toBe('openai');
    expect(runtime.agents['6-ui-designer']?.baseURL).toBe(
      'https://api.example.com/v1',
    );
  });

  test('injects active-agent provider options into global provider map', () => {
    persistAgentRuntimeSelection(tempDir, {
      agentName: '6-ui-designer',
      model: 'openai/gpt-5.2-codex',
      providerID: 'openai',
      apiKey: '{env:OPENAI_API_KEY}',
      baseURL: 'https://custom-openai.example/v1',
      activeAgentId: '6-ui-designer',
    });

    const merged = applyPersistedAgentModelOverrides(
      {
        provider: {
          openai: {
            options: {
              timeout: 10000,
            },
          },
        },
      },
      tempDir,
    );

    const provider = merged.provider?.openai as { options?: Record<string, unknown> };
    expect(provider.options?.timeout).toBe(10000);
    expect(provider.options?.apiKey).toBe('{env:OPENAI_API_KEY}');
    expect(provider.options?.baseURL).toBe('https://custom-openai.example/v1');
  });

  test('extracts model selection from message.updated user events only', () => {
    const extracted = extractAgentModelSelectionFromEvent({
      type: 'message.updated',
      properties: {
        info: {
          role: 'user',
          agent: '6-ui-designer',
          model: { providerID: 'openai', modelID: 'gpt-5.2-codex' },
        },
      },
    });

    expect(extracted).toEqual({
      agentName: '6-ui-designer',
      model: 'openai/gpt-5.2-codex',
      providerID: 'openai',
      activeAgentId: '6-ui-designer',
      source: 'message',
    });

    expect(
      extractAgentModelSelectionFromEvent({
        type: 'message.updated',
        properties: { info: { role: 'assistant' } },
      }),
    ).toBeNull();
  });

  test('extracts multi-agent settings save patch as runtime selections', () => {
    const extracted = extractAgentModelSelectionsFromEvent({
      type: 'settings.saved',
      properties: {
        patch: {
          set: {
            default_agent: '6-ui-designer',
            'agent.2-code-search.model': 'openai/gpt-5.1-codex-mini',
            'agent.2-code-search.providerID': 'openai',
            'agent.6-ui-designer.model': 'google/gemini-2.5-pro',
            'agent.6-ui-designer.baseURL': 'https://example.local/v1',
          },
        },
      },
    });

    expect(extracted).toHaveLength(2);
    const byAgent = Object.fromEntries(extracted.map((item) => [item.agentName, item]));
    expect(byAgent['2-code-search']?.model).toBe('openai/gpt-5.1-codex-mini');
    expect(byAgent['2-code-search']?.providerID).toBe('openai');
    expect(byAgent['2-code-search']?.activeAgentId).toBe('6-ui-designer');
    expect(byAgent['6-ui-designer']?.baseURL).toBe('https://example.local/v1');
    expect(byAgent['6-ui-designer']?.source).toBe('settings_save_patch');
  });
});
