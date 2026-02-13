import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  applyConfigPatch,
  readConfig,
  validateConfigPatch,
} from './store';

const tempDirs: string[] = [];

function createProjectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-settings-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('settings store', () => {
  test('initializes default config files', () => {
    const projectDir = createProjectDir();
    const config = readConfig(projectDir);
    expect(config).toBeDefined();
    expect((config.ui as { language?: string }).language).toBe('zh-CN');
    expect((config.autopilot as { maxCycles?: number }).maxCycles).toBe(8);
    expect(
      (
        config.intake as {
          stats?: {
            windowN?: number;
            downrankThresholdRatioX100?: number;
            downrankExplorePercent?: number;
          };
        }
      ).stats?.windowN,
    ).toBe(10);
    expect(
      (
        config.intake as {
          stats?: { downrankThresholdRatioX100?: number };
        }
      ).stats?.downrankThresholdRatioX100,
    ).toBe(150);
    expect(
      (
        config.intake as { stats?: { downrankExplorePercent?: number } }
      ).stats?.downrankExplorePercent,
    ).toBe(30);

    const configPath = path.join(projectDir, '.opencode', 'miya', 'config.json');
    const registryPath = path.join(
      projectDir,
      '.opencode',
      'miya',
      'registry.json',
    );
    const schemaPath = path.join(projectDir, '.opencode', 'miya', 'schema.json');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(registryPath)).toBe(true);
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  test('validates and applies set/unset patch', () => {
    const projectDir = createProjectDir();
    const validation = validateConfigPatch(projectDir, {
      set: {
        'ui.theme': 'light',
        'autopilot.maxCycles': 2,
      },
      unset: ['ui.dashboard.refreshMs'],
    });

    expect(validation.ok).toBe(true);
    expect(validation.maxRisk).toBe('MED');
    const applied = applyConfigPatch(projectDir, validation);
    expect(applied.applied.length).toBe(2);

    const updated = readConfig(projectDir);
    expect(
      ((updated.ui as { theme?: string }).theme as string) === 'light',
    ).toBe(true);
    expect(
      ((updated.autopilot as { maxCycles?: number }).maxCycles as number) === 2,
    ).toBe(true);
    expect(
      ((updated.ui as { dashboard?: { refreshMs?: number } }).dashboard
        ?.refreshMs as number) === 800,
    ).toBe(true);
  });

  test('supports JSON patch input', () => {
    const projectDir = createProjectDir();
    const validation = validateConfigPatch(projectDir, [
      { op: 'replace', path: '/voice/enabled', value: true },
      { op: 'replace', path: '/voice/input/stt', value: 'off' },
    ]);
    expect(validation.ok).toBe(true);
    expect(validation.maxRisk).toBe('HIGH');
  });

  test('rejects unknown keys', () => {
    const projectDir = createProjectDir();
    const validation = validateConfigPatch(projectDir, {
      set: {
        'foo.bar': true,
      },
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((item) => item.includes('Unknown setting key'))).toBe(
      true,
    );
  });
});
