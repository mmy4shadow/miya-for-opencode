import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PluginConfig } from '../config';
import { SUBAGENT_NAMES } from '../config';
import { createAgents, getAgentConfigs, isSubagent } from './index';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-agent-test-'));
}

describe('agent alias backward compatibility', () => {
  test("applies 'explore' config to '2-code-search' agent", () => {
    const config: PluginConfig = {
      agents: {
        explore: { model: 'test/old-explore-model' },
      },
    };
    const agents = createAgents(config);
    const explorer = agents.find((a) => a.name === '2-code-search');
    expect(explorer).toBeDefined();
    expect(explorer?.config.model).toBe('test/old-explore-model');
  });

  test("applies 'frontend-ui-ux-engineer' config to '6-ui-designer' agent", () => {
    const config: PluginConfig = {
      agents: {
        'frontend-ui-ux-engineer': { model: 'test/old-frontend-model' },
      },
    };
    const agents = createAgents(config);
    const designer = agents.find((a) => a.name === '6-ui-designer');
    expect(designer).toBeDefined();
    expect(designer?.config.model).toBe('test/old-frontend-model');
  });

  test('new name takes priority over old alias', () => {
    const config: PluginConfig = {
      agents: {
        explore: { model: 'old-model' },
        '2-code-search': { model: 'new-model' },
      },
    };
    const agents = createAgents(config);
    const explorer = agents.find((a) => a.name === '2-code-search');
    expect(explorer?.config.model).toBe('new-model');
  });

  test('new agent names work directly', () => {
    const config: PluginConfig = {
      agents: {
        '2-code-search': { model: 'direct-explorer' },
        '6-ui-designer': { model: 'direct-designer' },
      },
    };
    const agents = createAgents(config);
    expect(agents.find((a) => a.name === '2-code-search')?.config.model).toBe(
      'direct-explorer',
    );
    expect(agents.find((a) => a.name === '6-ui-designer')?.config.model).toBe(
      'direct-designer',
    );
  });

  test('temperature override via old alias', () => {
    const config: PluginConfig = {
      agents: {
        explore: { temperature: 0.5 },
      },
    };
    const agents = createAgents(config);
    const explorer = agents.find((a) => a.name === '2-code-search');
    expect(explorer?.config.temperature).toBe(0.5);
  });
});

describe('fixer agent fallback', () => {
  test('fixer uses default model when no config provided', () => {
    const config: PluginConfig = {
      agents: {
        '3-docs-helper': { model: 'librarian-custom-model' },
      },
    };
    const agents = createAgents(config);
    const fixer = agents.find((a) => a.name === '5-code-fixer');
    // Fixer uses its own default (openrouter/z-ai/glm-5)
    expect(fixer?.config.model).toBe('openrouter/z-ai/glm-5');
  });

  test('fixer uses its own model when explicitly configured', () => {
    const config: PluginConfig = {
      agents: {
        '3-docs-helper': { model: 'librarian-model' },
        '5-code-fixer': { model: 'fixer-specific-model' },
      },
    };
    const agents = createAgents(config);
    const fixer = agents.find((a) => a.name === '5-code-fixer');
    expect(fixer?.config.model).toBe('fixer-specific-model');
  });
});

describe('orchestrator agent', () => {
  test('orchestrator is first in agents array', () => {
    const agents = createAgents();
    expect(agents[0].name).toBe('1-task-manager');
  });

  test('orchestrator has question permission set to allow', () => {
    const agents = createAgents();
    const orchestrator = agents.find((a) => a.name === '1-task-manager');
    expect(orchestrator?.config.permission).toBeDefined();
    expect((orchestrator?.config.permission as any).question).toBe('allow');
  });

  test('orchestrator accepts overrides', () => {
    const config: PluginConfig = {
      agents: {
        '1-task-manager': {
          model: 'custom-orchestrator-model',
          temperature: 0.3,
        },
      },
    };
    const agents = createAgents(config);
    const orchestrator = agents.find((a) => a.name === '1-task-manager');
    expect(orchestrator?.config.model).toBe('custom-orchestrator-model');
    expect(orchestrator?.config.temperature).toBe(0.3);
  });
});

describe('isSubagent type guard', () => {
  test('returns true for valid subagent names', () => {
    expect(isSubagent('2-code-search')).toBe(true);
    expect(isSubagent('3-docs-helper')).toBe(true);
    expect(isSubagent('4-architecture-advisor')).toBe(true);
    expect(isSubagent('6-ui-designer')).toBe(true);
    expect(isSubagent('5-code-fixer')).toBe(true);
  });

  test('returns false for orchestrator', () => {
    expect(isSubagent('1-task-manager')).toBe(false);
  });

  test('returns false for invalid agent names', () => {
    expect(isSubagent('invalid-agent')).toBe(false);
    expect(isSubagent('')).toBe(false);
    expect(isSubagent('explore')).toBe(false); // old alias, not actual agent name
  });
});

describe('agent classification', () => {
  test('SUBAGENT_NAMES excludes orchestrator', () => {
    expect(SUBAGENT_NAMES).not.toContain('1-task-manager');
    expect(SUBAGENT_NAMES).toContain('2-code-search');
    expect(SUBAGENT_NAMES).toContain('5-code-fixer');
  });

  test('getAgentConfigs applies correct classification visibility and mode', () => {
    const configs = getAgentConfigs();

    // Primary agent
    expect(configs['1-task-manager'].mode).toBe('primary');

    // Subagents
    for (const name of SUBAGENT_NAMES) {
      expect(configs[name].mode).toBe('primary');
    }
  });
});

describe('createAgents', () => {
  test('creates all agents without config', () => {
    const agents = createAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain('1-task-manager');
    expect(names).toContain('2-code-search');
    expect(names).toContain('6-ui-designer');
    expect(names).toContain('4-architecture-advisor');
    expect(names).toContain('3-docs-helper');
    expect(names).toContain('5-code-fixer');
    // All agents should have valid models
    for (const agent of agents) {
      expect(agent.config.model).toBeDefined();
      expect(agent.config.model).toContain('/');
    }
  });

  test('creates exactly 7 agents by default (includes simplicity reviewer)', () => {
    const agents = createAgents();
    expect(agents.length).toBe(7);
  });

  test('does not enable slim prompt by default (keeps universal prompt)', () => {
    const agents = createAgents();
    const prompt = String(agents[0].config.prompt ?? '');
    expect(prompt.includes('7-code-simplicity-reviewer')).toBe(false);
  });

  test('enables slim prompt only when slimCompat flags are on', () => {
    const agents = createAgents({
      slimCompat: { enabled: true, useSlimOrchestratorPrompt: true },
    } as PluginConfig);
    const prompt = String(agents[0].config.prompt ?? '');
    expect(prompt.includes('7-code-simplicity-reviewer')).toBe(true);
  });

  test('adds code-simplicity-reviewer by default and allows explicit disable', () => {
    const enabledByDefault = createAgents();
    expect(
      enabledByDefault.some((a) => a.name === '7-code-simplicity-reviewer'),
    ).toBe(true);

    const disabled = createAgents({
      slimCompat: { enabled: true, enableCodeSimplicityReviewer: false },
    } as PluginConfig);
    expect(disabled.some((a) => a.name === '7-code-simplicity-reviewer')).toBe(
      false,
    );
  });

  test('injects soul persona layer when project directory is provided', () => {
    const projectDir = tempProjectDir();
    const agents = createAgents(undefined, projectDir);
    expect(String(agents[0].config.prompt).includes('<PersonaLayer>')).toBe(
      true,
    );
  });

  test('injects chat/work persona mode router into agent prompts', () => {
    const agents = createAgents();
    expect(
      String(agents[0].config.prompt).includes('<PersonaModeRouter>'),
    ).toBe(true);
    expect(
      String(agents[0].config.prompt).includes('<ContextHydraulicPress>'),
    ).toBe(true);
    expect(String(agents[0].config.prompt).includes('mode_decision')).toBe(
      true,
    );
    expect(
      String(
        agents.find((agent) => agent.name === '5-code-fixer')?.config.prompt,
      ).includes('Persona style: ZERO'),
    ).toBe(true);
  });
});

describe('getAgentConfigs', () => {
  test('returns config record keyed by agent name', () => {
    const configs = getAgentConfigs();
    expect(configs['1-task-manager']).toBeDefined();
    expect(configs['2-code-search']).toBeDefined();
    expect(configs['1-task-manager'].model).toBeDefined();
  });

  test('includes description in SDK config', () => {
    const configs = getAgentConfigs();
    expect(configs['1-task-manager'].description).toBeDefined();
    expect(configs['2-code-search'].description).toBeDefined();
  });
});
