import { type PluginConfig } from './schema';
/**
 * Load plugin configuration from user and project config files, merging them appropriately.
 *
 * Configuration is loaded from two locations:
 * 1. User config: ~/.config/opencode/miya.jsonc or .json (or $XDG_CONFIG_HOME)
 * 2. Project config: <directory>/.opencode/miya.jsonc or .json
 *
 * JSONC format is preferred over JSON (allows comments and trailing commas).
 * Project config takes precedence over user config. Nested objects (agents, tmux) are
 * deep-merged, while top-level arrays are replaced entirely by project config.
 *
 * @param directory - Project directory to search for .opencode config
 * @returns Merged plugin configuration (empty object if no configs found)
 */
export declare function loadPluginConfig(directory: string): PluginConfig;
/**
 * Load custom prompt for an agent from the prompts directory.
 * Checks for {agent}.md (replaces default) and {agent}_append.md (appends to default).
 *
 * @param agentName - Name of the agent (e.g., "orchestrator", "explorer")
 * @returns Object with prompt and/or appendPrompt if files exist
 */
export declare function loadAgentPrompt(agentName: string): {
    prompt?: string;
    appendPrompt?: string;
};
