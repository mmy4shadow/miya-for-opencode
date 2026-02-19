import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  bindSessionPersonaWorld,
  buildPersonaWorldPrompt,
  resolveSessionPersonaWorld,
  upsertPersonaPreset,
  upsertWorldPreset,
} from '../../src/companion/persona-world';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-persona-switch-'));
}

describe('persona mode switching verification', () => {
  test('falls back to default persona/world when binding points to missing presets', () => {
    const projectDir = tempProjectDir();
    bindSessionPersonaWorld(projectDir, {
      sessionID: 's1',
      personaPresetID: 'persona_missing',
      worldPresetID: 'world_missing',
    });

    const resolved = resolveSessionPersonaWorld(projectDir, 's1');
    expect(resolved.persona?.id).toBe('persona_default');
    expect(resolved.world?.id).toBe('world_default');
  });

  test('switching persona/world updates prompt payload deterministically', () => {
    const projectDir = tempProjectDir();
    const persona = upsertPersonaPreset(projectDir, {
      name: 'Focus Mode',
      persona: 'objective and direct',
      style: 'minimal',
      relationship: 'assistant',
      risk: 'medium',
    });
    const world = upsertWorldPreset(projectDir, {
      name: 'Release Room',
      summary: 'Production release coordination',
      rules: ['Prefer precise status updates.'],
      risk: 'medium',
    });
    bindSessionPersonaWorld(projectDir, {
      sessionID: 's2',
      personaPresetID: persona.id,
      worldPresetID: world.id,
    });

    const prompt = buildPersonaWorldPrompt(projectDir, 's2');
    expect(prompt).toContain(`id=${persona.id}`);
    expect(prompt).toContain(`id=${world.id}`);
    expect(prompt).toContain('[MIYA_PERSONA_WORLD_RISK] medium');
  });
});
