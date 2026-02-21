import { AGENT_ALIASES } from './constants';
import type { AgentOverrideConfig, PluginConfig } from './schema';

/**
 * Get agent override config by name, supporting backward-compatible aliases.
 * Checks both the current name and any legacy alias names.
 *
 * Priority:
 * 1. Direct match with canonical name
 * 2. Any alias that maps to this canonical name
 *
 * @param config - The plugin configuration
 * @param name - The current agent name (canonical)
 * @returns The agent-specific override configuration if found
 */
export function getAgentOverride(
  config: PluginConfig | undefined,
  name: string,
): AgentOverrideConfig | undefined {
  const overrides = config?.agents ?? {};

  // Priority 1: Direct match with canonical name
  if (overrides[name]) {
    return overrides[name];
  }

  // Priority 2: Find any alias that maps to this canonical name
  // AGENT_ALIASES: key=alias, value=canonical
  for (const [alias, canonical] of Object.entries(AGENT_ALIASES)) {
    if (canonical === name && overrides[alias]) {
      return overrides[alias];
    }
  }

  return undefined;
}
