import { type AgentName, type PluginConfig } from '.';
/** Default MCPs per agent - "*" means all MCPs, "!item" excludes specific MCPs */
export declare const DEFAULT_AGENT_MCPS: Record<AgentName, string[]>;
/**
 * Parse a list with wildcard and exclusion syntax.
 */
export declare function parseList(items: string[], allAvailable: string[]): string[];
/**
 * Get available MCP names from schema and config.
 */
export declare function getAvailableMcpNames(config?: PluginConfig): string[];
/**
 * Get the MCP list for an agent (from config or defaults).
 */
export declare function getAgentMcpList(agentName: string, config?: PluginConfig): string[];
