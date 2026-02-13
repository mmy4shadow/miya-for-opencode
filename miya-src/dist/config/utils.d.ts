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
export declare function getAgentOverride(config: PluginConfig | undefined, name: string): AgentOverrideConfig | undefined;
