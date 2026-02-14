import type { AgentConfig as SDKAgentConfig } from '@opencode-ai/sdk';
import { type PluginConfig, SUBAGENT_NAMES } from '../config';
import { type AgentDefinition } from './1-task-manager';
export type { AgentDefinition } from './1-task-manager';
export type SubagentName = (typeof SUBAGENT_NAMES)[number];
export declare function isSubagent(name: string): name is SubagentName;
/**
 * Create all agent definitions with optional configuration overrides.
 * Instantiates the orchestrator and all subagents, applying user config and defaults.
 *
 * @param config - Optional plugin configuration with agent overrides
 * @returns Array of agent definitions (orchestrator first, then subagents)
 */
export declare function createAgents(config?: PluginConfig): AgentDefinition[];
/**
 * Get agent configurations formatted for the OpenCode SDK.
 * Converts agent definitions to SDK config format and applies classification metadata.
 *
 * @param config - Optional plugin configuration with agent overrides
 * @returns Record mapping agent names to their SDK configurations
 */
export declare function getAgentConfigs(config?: PluginConfig): Record<string, SDKAgentConfig>;
