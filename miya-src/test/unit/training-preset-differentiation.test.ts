import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadPluginConfig } from '../../src/config/loader';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('training preset differentiation testing', () => {
  test('trims MIYA_PRESET before resolving preset agents', () => {
    const projectDir = tempDir('miya-preset-project-');
    const xdgDir = tempDir('miya-preset-xdg-');

    fs.writeFileSync(
      path.join(projectDir, 'miya.json'),
      JSON.stringify(
        {
          presets: {
            fast: {
              oracle: { model: 'preset-fast-model' },
            },
          },
          agents: {
            oracle: { temperature: 0.3 },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const prevXdg = process.env.XDG_CONFIG_HOME;
    const prevPreset = process.env.MIYA_PRESET;
    try {
      process.env.XDG_CONFIG_HOME = xdgDir;
      process.env.MIYA_PRESET = '  fast  ';
      const config = loadPluginConfig(projectDir);
      expect(config.preset).toBe('fast');
      expect(config.agents?.oracle?.model).toBe('preset-fast-model');
      expect(config.agents?.oracle?.temperature).toBe(0.3);
    } finally {
      if (typeof prevXdg === 'string') process.env.XDG_CONFIG_HOME = prevXdg;
      else delete process.env.XDG_CONFIG_HOME;
      if (typeof prevPreset === 'string')
        process.env.MIYA_PRESET = prevPreset;
      else delete process.env.MIYA_PRESET;
    }
  });
});
