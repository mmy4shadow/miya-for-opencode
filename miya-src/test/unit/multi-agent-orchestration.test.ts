import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from '../../src/config';
import { createAgents } from '../../src/agents';

describe('multi-agent orchestration hardening', () => {
  test('ignores non-finite temperature overrides from untrusted runtime input', () => {
    const config = {
      agents: {
        '5-code-fixer': {
          temperature: Number.NaN,
        },
      },
    } as unknown as PluginConfig;

    const agents = createAgents(config);
    const fixer = agents.find((item) => item.name === '5-code-fixer');
    expect(fixer?.config.temperature).toBe(0.2);
  });

  test('clamps out-of-range temperature overrides to safe bounds', () => {
    const config = {
      agents: {
        '1-task-manager': {
          temperature: 99,
        },
      },
    } as unknown as PluginConfig;

    const agents = createAgents(config);
    const orchestrator = agents.find((item) => item.name === '1-task-manager');
    expect(orchestrator?.config.temperature).toBe(2);
  });
});

