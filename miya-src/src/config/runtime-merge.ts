type GenericRecord = Record<string, unknown>;

/**
 * Merge plugin agent defaults into an existing OpenCode agent map without
 * clobbering user overrides (especially per-agent model selections).
 */
export function mergePluginAgentConfigs(
  existingAgents: GenericRecord | undefined,
  pluginAgents: Record<string, GenericRecord>,
): Record<string, GenericRecord> {
  const next: Record<string, GenericRecord> = {
    ...((existingAgents as Record<string, GenericRecord> | undefined) ?? {}),
  };

  for (const [agentName, pluginAgent] of Object.entries(pluginAgents)) {
    const existing = next[agentName];
    if (!existing || typeof existing !== 'object') {
      next[agentName] = { ...pluginAgent };
      continue;
    }

    const pluginPermission =
      pluginAgent.permission &&
      typeof pluginAgent.permission === 'object' &&
      !Array.isArray(pluginAgent.permission)
        ? (pluginAgent.permission as GenericRecord)
        : {};
    const existingPermission =
      existing.permission &&
      typeof existing.permission === 'object' &&
      !Array.isArray(existing.permission)
        ? (existing.permission as GenericRecord)
        : {};

    next[agentName] = {
      ...pluginAgent,
      ...existing,
      permission: {
        ...pluginPermission,
        ...existingPermission,
      },
    };
  }

  return next;
}
