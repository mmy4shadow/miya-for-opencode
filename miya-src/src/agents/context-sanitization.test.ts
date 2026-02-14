import { describe, expect, test } from 'bun:test';
import { getAgentConfigs } from './index';

describe('context sanitation + ralph loop integration', () => {
  test('task-manager prompt enforces zero-persona handoff and ralph loop path', () => {
    const configs = getAgentConfigs();
    const prompt = String(configs['1-task-manager']?.prompt ?? '');
    expect(prompt).toContain('force Zero-Persona wording');
    expect(prompt).toContain('run `miya_ralph_loop` with verification command');
  });

  test('code-fixer prompt remains zero persona style', () => {
    const configs = getAgentConfigs();
    const prompt = String(configs['5-code-fixer']?.prompt ?? '');
    expect(prompt).toContain('Persona style: ZERO');
  });
});
