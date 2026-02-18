import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import {
  applyPersistedAgentModelOverrides,
  extractAgentModelSelectionFromEvent,
  extractAgentModelSelectionsFromEvent,
  extractAgentRuntimeSelectionsFromCommandEvent,
  normalizeAgentName,
  normalizeModelRef,
  persistAgentModelSelection,
  persistAgentRuntimeSelection,
  readPersistedAgentModels,
  readPersistedAgentRuntime,
  syncPersistedAgentRuntimeFromOpenCodeState,
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
    expect(normalizeAgentName('simplicity_reviewer')).toBe(
      '7-code-simplicity-reviewer',
    );
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
    expect(
      normalizeModelRef({
        providerID: 'openrouter',
        modelID: 'openrouter/z-ai/glm-5',
      }),
    ).toBe('openrouter/z-ai/glm-5');
    expect(
      normalizeModelRef({
        providerID: 'openrouter',
        modelID: 'minimax/z-ai/glm-5',
      }),
    ).toBe('openrouter/z-ai/glm-5');
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
    const invalid = persistAgentModelSelection(
      tempDir,
      'oracle',
      'invalid-model',
    );
    expect(invalid).toBe(false);

    expect(readPersistedAgentModels(tempDir)).toEqual({
      '2-code-search': 'openai/gpt-5.1-codex-mini',
    });
  });

  test('applies persisted models as highest-priority agent overrides', () => {
    persistAgentModelSelection(
      tempDir,
      '6-ui-designer',
      'google/gemini-2.5-pro',
    );
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

    expect(merged.agents?.['1-task-manager']?.model).toBe(
      'openai/gpt-5.3-codex',
    );
    expect(merged.agents?.['1-task-manager']?.temperature).toBe(0.1);
    expect(merged.agents?.['6-ui-designer']?.model).toBe(
      'google/gemini-2.5-pro',
    );
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

    const provider = merged.provider?.openai as {
      options?: Record<string, unknown>;
    };
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
    const byAgent = Object.fromEntries(
      extracted.map((item) => [item.agentName, item]),
    );
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
    expect(runtime.agents['1-task-manager']?.model).toBe(
      'openai/gpt-5.3-codex',
    );
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

  test('persists seven agent configs independently without overwriting each other', () => {
    const entries = [
      ['1-task-manager', 'openai/gpt-5.3-codex'],
      ['2-code-search', 'openai/gpt-5.1-codex-mini'],
      ['3-docs-helper', 'openrouter/moonshotai/kimi-k2.5'],
      ['4-architecture-advisor', 'openai/gpt-5.2-codex'],
      ['5-code-fixer', 'openrouter/z-ai/glm-5'],
      ['6-ui-designer', 'google/gemini-2.5-pro'],
      ['7-code-simplicity-reviewer', 'openrouter/z-ai/glm-5'],
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

  test('extracts model selection from command.executed using active agent fallback', () => {
    const extracted = extractAgentRuntimeSelectionsFromCommandEvent(
      {
        type: 'command.executed',
        properties: {
          name: 'model',
          arguments: 'openrouter/z-ai/glm-5',
        },
      },
      '7-code-simplicity-reviewer',
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({
      agentName: '7-code-simplicity-reviewer',
      model: 'openrouter/z-ai/glm-5',
      providerID: 'openrouter',
      activeAgentId: '7-code-simplicity-reviewer',
    });
  });

  test('synchronizes per-agent models from opencode state files', () => {
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    const stateHome = path.join(tempDir, 'xdg-state');
    const stateDir = path.join(stateHome, 'opencode');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'model.json'),
      JSON.stringify(
        {
          activeAgent: '7-code-simplicity-reviewer',
          agents: {
            '2-code-search': {
              model: 'openai/gpt-5.1-codex-mini',
              providerID: 'openai',
            },
            '7-code-simplicity-reviewer': {
              model: 'openrouter/z-ai/glm-5',
              providerID: 'openrouter',
            },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    try {
      process.env.XDG_STATE_HOME = stateHome;
      const changed = syncPersistedAgentRuntimeFromOpenCodeState(tempDir);
      expect(changed).toBe(true);

      const runtime = readPersistedAgentRuntime(tempDir);
      expect(runtime.activeAgentId).toBe('7-code-simplicity-reviewer');
      expect(runtime.agents['2-code-search']?.model).toBe(
        'openai/gpt-5.1-codex-mini',
      );
      expect(runtime.agents['7-code-simplicity-reviewer']?.model).toBe(
        'openrouter/z-ai/glm-5',
      );
    } finally {
      if (previousXdgStateHome === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = previousXdgStateHome;
      }
    }
  });

  test('synchronizes per-agent models from model.json model map', () => {
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    const stateHome = path.join(tempDir, 'xdg-state');
    const stateDir = path.join(stateHome, 'opencode');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'model.json'),
      JSON.stringify(
        {
          activeAgentId: '6-ui-designer',
          model: {
            '2-code-search': {
              providerID: 'openai',
              modelID: 'gpt-5.1-codex-mini',
            },
            '6-ui-designer': {
              providerID: 'google',
              modelID: 'gemini-2.5-pro',
            },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    try {
      process.env.XDG_STATE_HOME = stateHome;
      const changed = syncPersistedAgentRuntimeFromOpenCodeState(tempDir);
      expect(changed).toBe(true);

      const runtime = readPersistedAgentRuntime(tempDir);
      expect(runtime.activeAgentId).toBe('6-ui-designer');
      expect(runtime.agents['2-code-search']?.model).toBe(
        'openai/gpt-5.1-codex-mini',
      );
      expect(runtime.agents['6-ui-designer']?.model).toBe(
        'google/gemini-2.5-pro',
      );
    } finally {
      if (previousXdgStateHome === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = previousXdgStateHome;
      }
    }
  });

  test('synchronizes per-agent models from kv local.model/local.agent keys', () => {
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    const stateHome = path.join(tempDir, 'xdg-state');
    const stateDir = path.join(stateHome, 'opencode');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'kv.json'),
      JSON.stringify(
        {
          'local.agent': '2-code-search',
          'local.model': {
            model: {
              '2-code-search': {
                providerID: 'openai',
                modelID: 'gpt-5.1-codex-mini',
              },
              '6-ui-designer': {
                providerID: 'google',
                modelID: 'gemini-2.5-pro',
              },
            },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    try {
      process.env.XDG_STATE_HOME = stateHome;
      const changed = syncPersistedAgentRuntimeFromOpenCodeState(tempDir);
      expect(changed).toBe(true);

      const runtime = readPersistedAgentRuntime(tempDir);
      expect(runtime.activeAgentId).toBe('2-code-search');
      expect(runtime.agents['2-code-search']?.model).toBe(
        'openai/gpt-5.1-codex-mini',
      );
      expect(runtime.agents['6-ui-designer']?.model).toBe(
        'google/gemini-2.5-pro',
      );
    } finally {
      if (previousXdgStateHome === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = previousXdgStateHome;
      }
    }
  });

  test('extracts generic settings patch events for compatibility', () => {
    const extracted = extractAgentModelSelectionsFromEvent({
      type: 'settings.store',
      properties: {
        activeAgent: '6-ui-designer',
        patch: {
          set: {
            'agent.6-ui-designer.model': 'google/gemini-2.5-pro',
            'agent.2-code-search.model': 'openai/gpt-5.1-codex-mini',
          },
        },
      },
    });

    expect(extracted).toHaveLength(2);
    const byAgent = Object.fromEntries(
      extracted.map((item) => [item.agentName, item]),
    );
    expect(byAgent['6-ui-designer']?.model).toBe('google/gemini-2.5-pro');
    expect(byAgent['6-ui-designer']?.source).toBe('settings_patch_generic');
    expect(byAgent['2-code-search']?.model).toBe('openai/gpt-5.1-codex-mini');
  });

  test('extracts model-selected event payloads before first message', () => {
    const extracted = extractAgentModelSelectionsFromEvent({
      type: 'model.selected',
      properties: {
        agentId: '6-ui-designer',
        providerID: 'openrouter',
        model: 'z-ai/glm-5',
      },
    });

    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({
      agentName: '6-ui-designer',
      model: 'openrouter/z-ai/glm-5',
      providerID: 'openrouter',
      source: 'event_generic',
    });
  });
});
