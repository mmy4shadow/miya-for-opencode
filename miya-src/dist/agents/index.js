import { getSkillPermissionsForAgent } from '../cli/skills';
import { AGENT_ALIASES, DEFAULT_MODELS, getAgentOverride, pickBestAvailableModel, loadAgentPrompt, SUBAGENT_NAMES, } from '../config';
import { getAgentMcpList } from '../config/agent-mcps';
import { createDesignerAgent } from './designer';
import { createExplorerAgent } from './explorer';
import { createFixerAgent } from './fixer';
import { createLibrarianAgent } from './librarian';
import { createOracleAgent } from './oracle';
import { createOrchestratorAgent } from './orchestrator';
// Agent Configuration Helpers
/**
 * Apply user-provided overrides to an agent's configuration.
 * Supports overriding model and temperature.
 */
function applyOverrides(agent, override) {
    if (override.model) {
        const candidates = [override.model, agent.config.model].filter((model) => typeof model === 'string' && model.length > 0);
        const selected = pickBestAvailableModel(candidates);
        if (selected) {
            agent.config.model = selected;
        }
    }
    if (override.temperature !== undefined)
        agent.config.temperature = override.temperature;
}
/**
 * Apply default permissions to an agent.
 * Sets 'question' permission to 'allow' and includes skill permission presets.
 * If configuredSkills is provided, it honors that list instead of defaults.
 */
function applyDefaultPermissions(agent, configuredSkills) {
    const existing = (agent.config.permission ?? {});
    // Get skill-specific permissions for this agent
    const skillPermissions = getSkillPermissionsForAgent(agent.name, configuredSkills);
    agent.config.permission = {
        ...existing,
        question: 'allow',
        // Apply skill permissions as nested object under 'skill' key
        skill: {
            ...(typeof existing.skill === 'object' ? existing.skill : {}),
            ...skillPermissions,
        },
    };
}
export function isSubagent(name) {
    return SUBAGENT_NAMES.includes(name);
}
// Agent Factories
const SUBAGENT_FACTORIES = {
    '2-code-search': createExplorerAgent,
    '3-docs-helper': createLibrarianAgent,
    '4-architecture-advisor': createOracleAgent,
    '5-code-fixer': createFixerAgent,
    '6-ui-designer': createDesignerAgent,
};
// Public API
function getFallbackChain(config, agentName) {
    const chains = config?.fallback?.chains;
    if (!chains)
        return [];
    const direct = chains[agentName];
    if (direct)
        return direct;
    const legacyName = Object.keys(AGENT_ALIASES).find((key) => AGENT_ALIASES[key] === agentName);
    if (legacyName && chains[legacyName]) {
        return chains[legacyName] ?? [];
    }
    return [];
}
function resolveAgentModel(config, agentName, defaults) {
    const overrideModel = getAgentOverride(config, agentName)?.model;
    const fallbackChain = getFallbackChain(config, agentName);
    const candidates = [
        ...(overrideModel ? [overrideModel] : []),
        ...fallbackChain,
        ...defaults,
    ];
    return pickBestAvailableModel(candidates) ?? defaults[0];
}
/**
 * Create all agent definitions with optional configuration overrides.
 * Instantiates the orchestrator and all subagents, applying user config and defaults.
 *
 * @param config - Optional plugin configuration with agent overrides
 * @returns Array of agent definitions (orchestrator first, then subagents)
 */
export function createAgents(config) {
    const getModelForAgent = (name) => {
        if (name === '5-code-fixer') {
            return resolveAgentModel(config, name, [
                DEFAULT_MODELS['5-code-fixer'],
                DEFAULT_MODELS['3-docs-helper'],
            ]);
        }
        return resolveAgentModel(config, name, [DEFAULT_MODELS[name]]);
    };
    // 1. Gather all sub-agent definitions with custom prompts
    const protoSubAgents = Object.entries(SUBAGENT_FACTORIES).map(([name, factory]) => {
        const customPrompts = loadAgentPrompt(name);
        return factory(getModelForAgent(name), customPrompts.prompt, customPrompts.appendPrompt);
    });
    // 2. Apply overrides and default permissions to each agent
    const allSubAgents = protoSubAgents.map((agent) => {
        const override = getAgentOverride(config, agent.name);
        if (override) {
            applyOverrides(agent, override);
        }
        applyDefaultPermissions(agent, override?.skills);
        return agent;
    });
    // 3. Create Orchestrator (with its own overrides and custom prompts)
    const orchestratorModel = resolveAgentModel(config, '1-task-manager', [
        DEFAULT_MODELS['1-task-manager'],
        DEFAULT_MODELS['4-architecture-advisor'],
        DEFAULT_MODELS['3-docs-helper'],
    ]);
    const orchestratorPrompts = loadAgentPrompt('1-task-manager');
    const orchestrator = createOrchestratorAgent(orchestratorModel, orchestratorPrompts.prompt, orchestratorPrompts.appendPrompt);
    const oOverride = getAgentOverride(config, '1-task-manager');
    applyDefaultPermissions(orchestrator, oOverride?.skills);
    if (oOverride) {
        applyOverrides(orchestrator, oOverride);
    }
    return [orchestrator, ...allSubAgents];
}
/**
 * Get agent configurations formatted for the OpenCode SDK.
 * Converts agent definitions to SDK config format and applies classification metadata.
 *
 * @param config - Optional plugin configuration with agent overrides
 * @returns Record mapping agent names to their SDK configurations
 */
export function getAgentConfigs(config) {
    const agents = createAgents(config);
    return Object.fromEntries(agents.map((a) => {
        const sdkConfig = {
            ...a.config,
            description: a.description,
            mcps: getAgentMcpList(a.name, config),
        };
        // Apply classification-based visibility and mode
        if (isSubagent(a.name)) {
            sdkConfig.mode = 'primary';
        }
        else if (a.name === '1-task-manager') {
            sdkConfig.mode = 'primary';
        }
        return [a.name, sdkConfig];
    }));
}
