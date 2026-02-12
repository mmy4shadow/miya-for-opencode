import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverSkills } from './loader';
import { listEnabledSkills, setSkillEnabled } from './state';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-skills-test-'));
}

function writeSkill(root: string, name: string, content: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

describe('skills discovery and state', () => {
  test('discovers workspace skills with frontmatter', () => {
    const projectDir = tempProjectDir();
    const workspaceSkills = path.join(projectDir, 'skills');
    writeSkill(
      workspaceSkills,
      'alpha',
      `---\nname: alpha\nversion: 1.0.0\nenv: MIYA_TEST_ENV\n---\n# Alpha`,
    );

    const skills = discoverSkills(projectDir);
    const alpha = skills.find((item) => item.name === 'alpha');

    expect(alpha).toBeDefined();
    expect(alpha?.source).toBe('workspace');
    expect(alpha?.gate.loadable).toBe(false);
    expect(alpha?.gate.reasons.some((reason) => reason.includes('missing_env'))).toBe(true);
  });

  test('stores enabled skill list', () => {
    const projectDir = tempProjectDir();
    expect(listEnabledSkills(projectDir)).toEqual([]);

    const enabled = setSkillEnabled(projectDir, 'alpha', true);
    expect(enabled).toEqual(['alpha']);

    const disabled = setSkillEnabled(projectDir, 'alpha', false);
    expect(disabled).toEqual([]);
  });
});
