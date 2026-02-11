import { getAgentOverride, McpNameSchema, } from '.';
/** Default MCPs per agent - "*" means all MCPs, "!item" excludes specific MCPs */
export const DEFAULT_AGENT_MCPS = {
    '1-task-manager': ['websearch'],
    '2-code-search': [],
    '3-docs-helper': ['websearch', 'context7', 'grep_app'],
    '4-architecture-advisor': [],
    '5-code-fixer': [],
    '6-ui-designer': [],
};
/**
 * Parse a list with wildcard and exclusion syntax.
 */
export function parseList(items, allAvailable) {
    if (!items || items.length === 0) {
        return [];
    }
    const allow = items.filter((i) => !i.startsWith('!'));
    const deny = items.filter((i) => i.startsWith('!')).map((i) => i.slice(1));
    if (deny.includes('*')) {
        return [];
    }
    if (allow.includes('*')) {
        return allAvailable.filter((item) => !deny.includes(item));
    }
    return allow.filter((item) => !deny.includes(item));
}
/**
 * Get available MCP names from schema and config.
 */
export function getAvailableMcpNames(config) {
    const builtinMcps = McpNameSchema.options;
    const disabled = new Set(config?.disabled_mcps ?? []);
    return builtinMcps.filter((name) => !disabled.has(name));
}
/**
 * Get the MCP list for an agent (from config or defaults).
 */
export function getAgentMcpList(agentName, config) {
    const agentConfig = getAgentOverride(config, agentName);
    if (agentConfig?.mcps !== undefined) {
        return agentConfig.mcps;
    }
    const defaultMcps = DEFAULT_AGENT_MCPS[agentName];
    return defaultMcps ?? [];
}
