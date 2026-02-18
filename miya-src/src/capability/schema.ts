import type { SkillDescriptor } from '../skills/loader';

export interface CapabilitySchema {
  id: string;
  version: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  sideEffects: string[];
  permissions: string[];
  auditFields: string[];
  fallbackPlan: string;
}

function normalizeUnique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function inferSideEffects(capabilityID: string): string[] {
  const id = capabilityID.toLowerCase();
  const effects: string[] = [];
  if (id.includes('send') || id.includes('outbound') || id.includes('invoke'))
    effects.push('network');
  if (id.includes('desktop') || id.includes('voice') || id.includes('media'))
    effects.push('desktop');
  if (
    id.includes('config') ||
    id.includes('write') ||
    id.includes('set') ||
    id.includes('patch') ||
    id.includes('install') ||
    id.includes('update') ||
    id.includes('rollback')
  ) {
    effects.push('filesystem');
  }
  if (id.includes('process') || id.includes('daemon') || id.includes('run'))
    effects.push('process');
  if (id.includes('memory') || id.includes('learning')) effects.push('memory');
  if (effects.length === 0) effects.push('none');
  return normalizeUnique(effects);
}

function inferPermissions(capabilityID: string): string[] {
  const id = capabilityID.toLowerCase();
  const permissions: string[] = [];
  if (id.includes('channels.message.send') || id.includes('outbound'))
    permissions.push('external_message');
  if (id.includes('desktop')) permissions.push('desktop_control');
  if (id.includes('config') || id.includes('patch') || id.includes('write'))
    permissions.push('fs_write');
  if (id.includes('memory')) permissions.push('memory_write');
  if (id.includes('security')) permissions.push('security_sensitive');
  if (permissions.length === 0) permissions.push('read_only');
  return normalizeUnique(permissions);
}

function defaultAuditFields(capabilityID: string): string[] {
  return normalizeUnique([
    'traceID',
    'sessionID',
    'policyHash',
    'inputHash',
    'resultHash',
    capabilityID.includes('channels.message.send') ? 'payloadHash' : '',
  ]);
}

function buildSchema(
  id: string,
  input?: Partial<CapabilitySchema>,
): CapabilitySchema {
  return {
    id,
    version: input?.version ?? '1.0.0',
    inputs: input?.inputs ?? {
      type: 'object',
      additionalProperties: true,
    },
    outputs: input?.outputs ?? {
      type: 'object',
      additionalProperties: true,
    },
    sideEffects: normalizeUnique(input?.sideEffects ?? inferSideEffects(id)),
    permissions: normalizeUnique(input?.permissions ?? inferPermissions(id)),
    auditFields: normalizeUnique(input?.auditFields ?? defaultAuditFields(id)),
    fallbackPlan:
      input?.fallbackPlan ??
      'degrade_to_safe_mode_with_audit_and_request_human_confirmation',
  };
}

export function buildGatewayCapabilitySchemas(
  methods: string[],
): CapabilitySchema[] {
  return methods
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((method) => buildSchema(`gateway.${method}`));
}

export function buildSkillCapabilitySchemas(
  skills: SkillDescriptor[],
): CapabilitySchema[] {
  return skills.map((skill) =>
    buildSchema(`skill.${skill.id}`, {
      version: skill.frontmatter.version || '1.0.0',
      permissions:
        Array.isArray(skill.frontmatter.permissions) &&
        skill.frontmatter.permissions.length > 0
          ? skill.frontmatter.permissions
          : inferPermissions(skill.id),
      inputs: {
        source: skill.source,
        bins: skill.frontmatter.bins ?? [],
        env: skill.frontmatter.env ?? [],
        platforms: skill.frontmatter.platforms ?? [],
      },
      outputs: {
        loadable: skill.gate.loadable,
        reasons: skill.gate.reasons,
      },
      fallbackPlan: skill.gate.loadable
        ? 'fallback_to_builtin_or_human_assist_if_runtime_error'
        : 'deny_load_and_emit_governance_reason',
    }),
  );
}

export function buildToolCapabilitySchemas(
  toolNames: string[],
): CapabilitySchema[] {
  return toolNames
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((toolName) => buildSchema(`tool.${toolName}`));
}
