import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  bindSessionPersonaWorld,
  buildPersonaWorldPrompt,
  listPersonaPresets,
  listWorldPresets,
  resolveSessionPersonaWorld,
  upsertPersonaPreset,
  upsertWorldPreset,
} from './persona-world';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-persona-world-test-'));
}

describe('persona world presets', () => {
  test('upserts presets and binds them to session', () => {
    const projectDir = tempProjectDir();
    const persona = upsertPersonaPreset(projectDir, {
      name: 'Architect Mode',
      persona: 'systematic and critical',
      style: 'precise',
      relationship: 'technical partner',
      risk: 'medium',
    });
    const world = upsertWorldPreset(projectDir, {
      name: 'Release War Room',
      summary: 'High pressure release operations context',
      rules: ['Always verify rollback path first.'],
      tags: ['release', 'ops'],
      risk: 'high',
    });
    const binding = bindSessionPersonaWorld(projectDir, {
      sessionID: 's1',
      personaPresetID: persona.id,
      worldPresetID: world.id,
    });
    expect(binding.sessionID).toBe('s1');
    const resolved = resolveSessionPersonaWorld(projectDir, 's1');
    expect(resolved.risk).toBe('high');
    const prompt = buildPersonaWorldPrompt(projectDir, 's1');
    expect(prompt.includes('[MIYA_PERSONA')).toBe(true);
    expect(prompt.includes('[MIYA_WORLD')).toBe(true);
    expect(listPersonaPresets(projectDir).length).toBeGreaterThan(0);
    expect(listWorldPresets(projectDir).length).toBeGreaterThan(0);
  });
});
