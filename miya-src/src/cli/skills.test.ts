import { describe, expect, it } from 'bun:test';
import { getSkillPermissionsForAgent } from './skills';

describe('skills permissions', () => {
  it('should allow all skills for 1-task-manager by default', () => {
    const permissions = getSkillPermissionsForAgent('1-task-manager');
    expect(permissions['*']).toBe('allow');
  });

  it('should deny all skills for other agents by default', () => {
    const permissions = getSkillPermissionsForAgent('6-ui-designer');
    expect(permissions['*']).toBe('deny');
  });

  it('should allow recommended skills for specific agents', () => {
    // Designer should have agent-browser allowed
    const designerPerms = getSkillPermissionsForAgent('6-ui-designer');
    expect(designerPerms['agent-browser']).toBe('allow');

    // Developer (1-task-manager) should have simplify allowed (and everything else via *)
    const orchPerms = getSkillPermissionsForAgent('1-task-manager');
    expect(orchPerms.simplify).toBe('allow');
    expect(orchPerms.cartography).toBe('allow');
  });

  it('should honor explicit skill list overrides', () => {
    // Override with empty list
    const emptyPerms = getSkillPermissionsForAgent('1-task-manager', []);
    expect(emptyPerms['*']).toBe('deny');
    expect(Object.keys(emptyPerms).length).toBe(1);

    // Override with specific list
    const specificPerms = getSkillPermissionsForAgent('6-ui-designer', [
      'my-skill',
      '!bad-skill',
    ]);
    expect(specificPerms['*']).toBe('deny');
    expect(specificPerms['my-skill']).toBe('allow');
    expect(specificPerms['bad-skill']).toBe('deny');
  });

  it('should honor wildcard in explicit list', () => {
    const wildcardPerms = getSkillPermissionsForAgent('6-ui-designer', ['*']);
    expect(wildcardPerms['*']).toBe('allow');
  });
});
