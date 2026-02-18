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
      `---\nname: alpha\nversion: 1.0.0\nenv: MIYA_TEST_ENV\npermissions: shell_exec\n---\n# Alpha`,
    );

    const skills = discoverSkills(projectDir);
    const alpha = skills.find((item) => item.name === 'alpha');

    expect(alpha).toBeDefined();
    expect(alpha?.source).toBe('workspace');
    expect(alpha?.gate.loadable).toBe(false);
    expect(
      alpha?.gate.reasons.some((reason) => reason.includes('missing_env')),
    ).toBe(true);
  });

  test('marks workspace skill as not loadable when permission metadata is missing', () => {
    const projectDir = tempProjectDir();
    const workspaceSkills = path.join(projectDir, 'skills');
    writeSkill(
      workspaceSkills,
      'no-permission-skill',
      `---\nname: no-permission-skill\nversion: 1.0.0\n---\n# Missing permission metadata`,
    );

    const skills = discoverSkills(projectDir);
    const target = skills.find((item) => item.name === 'no-permission-skill');

    expect(target).toBeDefined();
    expect(target?.gate.loadable).toBe(false);
    expect(target?.gate.reasons).toContain('missing_permission_metadata');
  });

  test('accepts yaml-list permissions metadata', () => {
    const projectDir = tempProjectDir();
    const workspaceSkills = path.join(projectDir, 'skills');
    writeSkill(
      workspaceSkills,
      'yaml-permissions',
      `---\nname: yaml-permissions\npermissions:\n  - shell_exec\n  - fs_read\n---\n# YAML permissions`,
    );

    const skills = discoverSkills(projectDir);
    const target = skills.find((item) => item.name === 'yaml-permissions');

    expect(target).toBeDefined();
    expect(target?.frontmatter.permissions).toEqual(['shell_exec', 'fs_read']);
    expect(target?.gate.loadable).toBe(true);
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
