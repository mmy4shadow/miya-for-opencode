import { describe, expect, test } from 'bun:test';
import {
  buildGatewayCapabilitySchemas,
  buildSkillCapabilitySchemas,
  buildToolCapabilitySchemas,
} from './schema';

describe('capability schema builders', () => {
  test('builds required fields for tool and gateway capabilities', () => {
    const tools = buildToolCapabilitySchemas(['miya_gateway_start']);
    const gateway = buildGatewayCapabilitySchemas(['gateway.status.get']);
    for (const row of [...tools, ...gateway]) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.version).toBe('string');
      expect(typeof row.inputs).toBe('object');
      expect(typeof row.outputs).toBe('object');
      expect(Array.isArray(row.sideEffects)).toBe(true);
      expect(Array.isArray(row.permissions)).toBe(true);
      expect(Array.isArray(row.auditFields)).toBe(true);
      expect(typeof row.fallbackPlan).toBe('string');
    }
  });

  test('derives skill schema from loader descriptor', () => {
    const schemas = buildSkillCapabilitySchemas([
      {
        id: 'safe-skill',
        name: 'safe-skill',
        source: 'workspace',
        dir: '/tmp/safe',
        skillFile: '/tmp/safe/SKILL.md',
        frontmatter: {
          version: '1.2.3',
          permissions: ['shell_exec'],
        },
        gate: {
          loadable: true,
          reasons: [],
        },
      },
    ]);
    expect(schemas.length).toBe(1);
    expect(schemas[0]?.id).toBe('skill.safe-skill');
    expect(schemas[0]?.version).toBe('1.2.3');
    expect(schemas[0]?.permissions).toContain('shell_exec');
  });
});
