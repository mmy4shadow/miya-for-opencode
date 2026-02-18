import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSoulProfile, saveSoulMarkdown, soulPersonaLayer } from './loader';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-soul-test-'));
}

describe('soul loader', () => {
  test('loads default profile when file missing', () => {
    const projectDir = tempProjectDir();
    const profile = loadSoulProfile(projectDir);
    expect(profile.name).toBe('Miya');
    expect(profile.revision.length).toBeGreaterThan(6);
    expect(profile.rawMarkdown.includes('# SOUL.md')).toBe(true);
  });

  test('saves and rebuilds persona layer', () => {
    const projectDir = tempProjectDir();
    saveSoulMarkdown(
      projectDir,
      `# SOUL.md

## 身份
- 名称：MiyaX
- 角色：assistant
- 语气：precise

## 工作模式附加
- 提供验收清单

## 对话模式附加
- 先安抚再行动
`,
    );
    const layer = soulPersonaLayer(projectDir, {
      mode: 'work',
      depth: 'minimal',
    });
    expect(layer.includes('name: MiyaX')).toBe(true);
    expect(layer.includes('mode: work')).toBe(true);
    expect(layer.includes('depth: minimal')).toBe(true);
    expect(layer.includes('提供验收清单')).toBe(true);
  });
});
