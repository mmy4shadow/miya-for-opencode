import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyPersistedAgentModelOverrides,
  extractAgentModelSelectionFromEvent,
  normalizeAgentName,
  normalizeModelRef,
  persistAgentModelSelection,
  readPersistedAgentModels,
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

  test('extracts model selection from message.updated user events only', () => {
    const extracted = extractAgentModelSelectionFromEvent({
      type: 'message.updated',
      properties: {
        info: {
          role: 'user',
          agent: 'designer',
          model: { providerID: 'openai', modelID: 'gpt-5.2-codex' },
        },
      },
    });

    expect(extracted).toEqual({
      agentName: '6-ui-designer',
      model: 'openai/gpt-5.2-codex',
    });

    expect(
      extractAgentModelSelectionFromEvent({
        type: 'message.updated',
        properties: { info: { role: 'assistant' } },
      }),
    ).toBeNull();
  });
});
