import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import {
  applyPersistedAgentModelOverrides,
  extractAgentModelSelectionFromEvent,
  extractAgentModelSelectionsFromEvent,
  normalizeAgentName,
  normalizeModelRef,
  removePersistedAgentRuntimeSelection,
  persistAgentModelSelection,
  persistAgentRuntimeFromConfigSnapshot,
  persistAgentRuntimeFromUiModelState,
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
    delete process.env.XDG_STATE_HOME;
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
    expect(normalizeModelRef('openrouter/minimax/z-ai/glm-5')).toBe(
      'openrouter/z-ai/glm-5',
    );
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

  test('migrates legacy agent-models file to agent-runtime file on first read', () => {
    const runtimeDir = getMiyaRuntimeDir(tempDir);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const legacyFile = path.join(runtimeDir, 'agent-models.json');
    fs.writeFileSync(
      legacyFile,
      JSON.stringify(
        {
          updatedAt: '2026-02-14T00:00:00.000Z',
          agents: {
            orchestrator: 'openai/gpt-5.3-codex',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const runtime = readPersistedAgentRuntime(tempDir);
    const runtimeFile = path.join(runtimeDir, 'agent-runtime.json');
    expect(fs.existsSync(runtimeFile)).toBe(true);
    expect(runtime.revision).toBeGreaterThanOrEqual(1);
    expect(runtime.agents['1-task-manager']?.model).toBe('openai/gpt-5.3-codex');
  });

  test('extracts provider patch into active agent runtime selection', () => {
    const extracted = extractAgentModelSelectionsFromEvent({
      type: 'settings.saved',
      properties: {
        activeAgent: '6-ui-designer',
        patch: {
          set: {
            'provider.openai.options.baseURL': 'https://regional.example/v1',
            'provider.openai.options.apiKey': '{env:OPENAI_AGENT6_KEY}',
          },
        },
      },
    });

    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.agentName).toBe('6-ui-designer');
    expect(extracted[0]?.providerID).toBe('openai');
    expect(extracted[0]?.baseURL).toBe('https://regional.example/v1');
    expect(extracted[0]?.apiKey).toBe('{env:OPENAI_AGENT6_KEY}');
  });

  test('extracts settings patch with agents.* keys and defaultAgent', () => {
    const extracted = extractAgentModelSelectionsFromEvent({
      type: 'settings.saved',
      properties: {
        patch: {
          set: {
            defaultAgent: '5-code-fixer',
            'agents.3-docs-helper.model': 'openrouter/moonshotai/kimi-k2.5',
            'agents.6-ui-designer.model': 'google/gemini-2.5-pro',
          },
        },
      },
    });

    expect(extracted).toHaveLength(2);
    const byAgent = Object.fromEntries(extracted.map((item) => [item.agentName, item]));
    expect(byAgent['3-docs-helper']?.model).toBe('openrouter/moonshotai/kimi-k2.5');
    expect(byAgent['3-docs-helper']?.activeAgentId).toBe('5-code-fixer');
    expect(byAgent['6-ui-designer']?.model).toBe('google/gemini-2.5-pro');
  });

  test('extracts active-agent relative settings patch without cross-agent overwrite', () => {
    const extracted = extractAgentModelSelectionsFromEvent({
      type: 'settings.saved',
      properties: {
        activeAgent: '1-task-manager',
        patch: {
          set: {
            'agent.model': 'openrouter/moonshotai/kimi-k2.5',
            'agent.providerID': 'openrouter',
          },
        },
      },
    });

    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.agentName).toBe('1-task-manager');
    expect(extracted[0]?.model).toBe('openrouter/moonshotai/kimi-k2.5');
    expect(extracted[0]?.activeAgentId).toBe('1-task-manager');
  });

  test('extracts nested model fields with selectedAgent hint', () => {
    const extracted = extractAgentModelSelectionsFromEvent({
      type: 'settings.saved',
      properties: {
        selectedAgent: '5-code-fixer',
        patch: {
          set: {
            'agent.model.providerID': 'openrouter',
            'agent.model.modelID': 'z-ai/glm-5',
            'provider.openrouter.options.baseURL': 'https://openrouter.example/v1',
          },
        },
      },
    });

    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.agentName).toBe('5-code-fixer');
    expect(extracted[0]?.model).toBe('openrouter/z-ai/glm-5');
    expect(extracted[0]?.providerID).toBe('openrouter');
    expect(extracted[0]?.baseURL).toBe('https://openrouter.example/v1');
  });

  test('syncs persisted runtime from opencode config snapshot', () => {
    const result = persistAgentRuntimeFromConfigSnapshot(tempDir, {
      default_agent: '6-ui-designer',
      agent: {
        '3-docs-helper': {
          model: 'openrouter/moonshotai/kimi-k2.5',
          providerID: 'openrouter',
        },
        '6-ui-designer': {
          model: 'google/gemini-2.5-pro',
          providerID: 'google',
          baseURL: 'https://gemini.example/v1',
        },
      },
    });

    expect(result.updated).toBeGreaterThan(0);
    expect(result.activeAgentId).toBe('6-ui-designer');
    const runtime = readPersistedAgentRuntime(tempDir);
    expect(runtime.activeAgentId).toBe('6-ui-designer');
    expect(runtime.agents['3-docs-helper']?.model).toBe('openrouter/moonshotai/kimi-k2.5');
    expect(runtime.agents['6-ui-designer']?.baseURL).toBe('https://gemini.example/v1');
  });

  test('syncs persisted runtime from ui model state file when present', () => {
    const stateHome = path.join(tempDir, 'state-home');
    process.env.XDG_STATE_HOME = stateHome;
    const stateDir = path.join(stateHome, 'opencode');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'model.json'),
      JSON.stringify(
        {
          model: {
            '1-task-manager': { providerID: 'openai', modelID: 'gpt-5.3-codex' },
            '2-code-search': { providerID: 'openai', modelID: 'gpt-5.1-codex-mini' },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const result = persistAgentRuntimeFromUiModelState(tempDir);
    expect(result.updated).toBe(2);
    expect(result.sourcePath?.endsWith(path.join('opencode', 'model.json'))).toBe(true);

    const runtime = readPersistedAgentRuntime(tempDir);
    expect(runtime.agents['1-task-manager']?.model).toBe('openai/gpt-5.3-codex');
    expect(runtime.agents['2-code-search']?.model).toBe('openai/gpt-5.1-codex-mini');
  });

  test('persists six agent configs independently without overwriting each other', () => {
    const entries = [
      ['1-task-manager', 'openai/gpt-5.3-codex'],
      ['2-code-search', 'openai/gpt-5.1-codex-mini'],
      ['3-docs-helper', 'openrouter/moonshotai/kimi-k2.5'],
      ['4-architecture-advisor', 'openai/gpt-5.2-codex'],
      ['5-code-fixer', 'openrouter/z-ai/glm-5'],
      ['6-ui-designer', 'google/gemini-2.5-pro'],
    ] as const;

    for (const [agentName, model] of entries) {
      const changed = persistAgentRuntimeSelection(tempDir, {
        agentName,
        model,
        providerID: model.split('/')[0],
        activeAgentId: agentName,
      });
      expect(changed).toBe(true);
    }

    const runtime = readPersistedAgentRuntime(tempDir);
    for (const [agentName, model] of entries) {
      expect(runtime.agents[agentName]?.model).toBe(model);
      expect(runtime.agents[agentName]?.providerID).toBe(model.split('/')[0]);
    }
  });

  test('removes persisted runtime selection and clears active agent when requested', () => {
    persistAgentRuntimeSelection(tempDir, {
      agentName: '6-ui-designer',
      model: 'google/gemini-2.5-pro',
      activeAgentId: '6-ui-designer',
    });

    const changed = removePersistedAgentRuntimeSelection(tempDir, '6-ui-designer', {
      clearActive: true,
    });
    expect(changed).toBe(true);

    const runtime = readPersistedAgentRuntime(tempDir);
    expect(runtime.agents['6-ui-designer']).toBeUndefined();
    expect(runtime.activeAgentId).toBeUndefined();
  });
});
