import type { AgentOverrideConfig, PluginConfig } from './schema';
/**
 * Get agent override config by name, supporting backward-compatible aliases.
 * Checks both the current name and any legacy alias names.
 *
 * @param config - The plugin configuration
 * @param name - The current agent name
 * @returns The agent-specific override configuration if found
 */
export declare function getAgentOverride(config: PluginConfig | undefined, name: string): AgentOverrideConfig | undefined;
