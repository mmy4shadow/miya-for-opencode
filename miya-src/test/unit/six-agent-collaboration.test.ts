import { describe, expect, test } from 'bun:test';
import { createAgents, getAgentConfigs } from '../../src/agents';

const REQUIRED_AGENT_SET = [
  '1-task-manager',
  '2-code-search',
  '3-docs-helper',
  '4-architecture-advisor',
  '5-code-fixer',
  '6-ui-designer',
] as const;

describe('six-agent collaboration testing', () => {
  test('includes required six-agent baseline topology', () => {
    const agents = createAgents();
    const names = agents.map((agent) => agent.name);
    for (const required of REQUIRED_AGENT_SET) {
      expect(names.includes(required)).toBe(true);
    }
  });

  test('keeps unique agent names and routable primary configs', () => {
    const agents = createAgents();
    const unique = new Set(agents.map((agent) => agent.name));
    expect(unique.size).toBe(agents.length);

    const configs = getAgentConfigs();
    for (const required of REQUIRED_AGENT_SET) {
      expect(configs[required]?.mode).toBe('primary');
    }
  });
});
