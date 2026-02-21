import { describe, expect, test } from 'vitest';
import { mergePluginAgentConfigs } from './runtime-merge';

describe('mergePluginAgentConfigs', () => {
  test('keeps user-selected model while merging plugin defaults', () => {
    const merged = mergePluginAgentConfigs(
      {
        '1-task-manager': {
          model: 'openai/gpt-5.2-codex',
          temperature: 0.1,
          permission: {
            question: 'allow',
          },
        },
      },
      {
        '1-task-manager': {
          model: 'kimi-for-coding/k2p5',
          prompt: 'plugin prompt',
          permission: {
            question: 'allow',
            write: 'deny',
          },
        },
      },
    );

    expect(merged['1-task-manager']?.model).toBe('openai/gpt-5.2-codex');
    expect(merged['1-task-manager']?.prompt).toBe('plugin prompt');
    expect(
      (merged['1-task-manager']?.permission as Record<string, string>)?.write,
    ).toBe('deny');
  });

  test('adds missing plugin agent configs', () => {
    const merged = mergePluginAgentConfigs(
      {
        '1-task-manager': { model: 'openai/gpt-5.2-codex' },
      },
      {
        '6-ui-designer': { model: 'kimi-for-coding/k2p5' },
      },
    );

    expect(merged['6-ui-designer']).toEqual({
      model: 'kimi-for-coding/k2p5',
    });
  });
});
