import type { AgentConfig as SDKAgentConfig } from '@opencode-ai/sdk';
import { getSkillPermissionsForAgent } from '../cli/skills';
import {
  AGENT_ALIASES,
  type AgentOverrideConfig,
  DEFAULT_MODELS,
  getAgentOverride,
  pickBestAvailableModel,
  loadAgentPrompt,
  type PluginConfig,
  SUBAGENT_NAMES,
} from '../config';
import { getAgentMcpList } from '../config/agent-mcps';
import { soulPersonaLayer } from '../soul';

import { createDesignerAgent } from './6-ui-designer';
import { createExplorerAgent } from './2-code-search';
import { createFixerAgent } from './5-code-fixer';
import { createLibrarianAgent } from './3-docs-helper';
import { createOracleAgent } from './4-architecture-advisor';
import { type AgentDefinition, createOrchestratorAgent } from './1-task-manager';

export type { AgentDefinition } from './1-task-manager';

type AgentFactory = (
  model: string,
  customPrompt?: string,
  customAppendPrompt?: string,
) => AgentDefinition;

// Agent Configuration Helpers

/**
 * Apply user-provided overrides to an agent's configuration.
 * Supports overriding model and temperature.
 */
function applyOverrides(
  agent: AgentDefinition,
  override: AgentOverrideConfig,
): void {
  // Apply model override directly - user config takes priority
  if (override.model && override.model.trim().length > 0) {
    agent.config.model = override.model.trim();
  }
  // Apply temperature override
  if (override.temperature !== undefined)
    agent.config.temperature = override.temperature;
  if (override.variant && override.variant.trim().length > 0) {
    (agent.config as Record<string, unknown>).variant = override.variant.trim();
  }
  if (override.providerID && override.providerID.trim().length > 0) {
    (agent.config as Record<string, unknown>).providerID = override.providerID.trim();
  }
  if (override.options) {
    (agent.config as Record<string, unknown>).options = override.options;
  }
  if (override.apiKey && override.apiKey.trim().length > 0) {
    (agent.config as Record<string, unknown>).apiKey = override.apiKey.trim();
  }
  if (override.baseURL && override.baseURL.trim().length > 0) {
    (agent.config as Record<string, unknown>).baseURL = override.baseURL.trim();
  }
}

/**
 * Apply default permissions to an agent.
 * Sets 'question' permission to 'allow' and includes skill permission presets.
 * If configuredSkills is provided, it honors that list instead of defaults.
 */
function applyDefaultPermissions(
  agent: AgentDefinition,
  configuredSkills?: string[],
): void {
  const existing = (agent.config.permission ?? {}) as Record<
    string,
    'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
  >;

  // Get skill-specific permissions for this agent
  const skillPermissions = getSkillPermissionsForAgent(
    agent.name,
    configuredSkills,
  );

  agent.config.permission = {
    ...existing,
    question: 'allow',
    // Apply skill permissions as nested object under 'skill' key
    skill: {
      ...(typeof existing.skill === 'object' ? existing.skill : {}),
      ...skillPermissions,
    },
  } as SDKAgentConfig['permission'];
}

// Agent Classification

export type SubagentName = (typeof SUBAGENT_NAMES)[number];

export function isSubagent(name: string): name is SubagentName {
  return (SUBAGENT_NAMES as readonly string[]).includes(name);
}

// Agent Factories

const SUBAGENT_FACTORIES: Record<SubagentName, AgentFactory> = {
  '2-code-search': createExplorerAgent,
  '3-docs-helper': createLibrarianAgent,
  '4-architecture-advisor': createOracleAgent,
  '5-code-fixer': createFixerAgent,
  '6-ui-designer': createDesignerAgent,
};

// Public API

function getFallbackChain(config: PluginConfig | undefined, agentName: string): string[] {
  const chains = config?.fallback?.chains as
    | Record<string, string[] | undefined>
    | undefined;
  if (!chains) return [];

  const direct = chains[agentName];
  if (direct) return direct;

  const legacyName = Object.keys(AGENT_ALIASES).find(
    (key) => AGENT_ALIASES[key] === agentName,
  );
  if (legacyName && chains[legacyName]) {
    return chains[legacyName] ?? [];
  }

  return [];
}

// Ultimate fallback model - always available
const ULTIMATE_FALLBACK_MODEL = 'openrouter/z-ai/glm-5';

function resolveAgentModel(
  config: PluginConfig | undefined,
  agentName: string,
  defaults: readonly string[],
): string {
  const overrideModel = getAgentOverride(config, agentName)?.model;
  const fallbackChain = getFallbackChain(config, agentName);

  const candidates = [
    ...(overrideModel ? [overrideModel] : []),
    ...fallbackChain,
    ...defaults,
    ULTIMATE_FALLBACK_MODEL, // Always add ultimate fallback
  ];

  return pickBestAvailableModel(candidates) ?? ULTIMATE_FALLBACK_MODEL;
}

/**
 * Create all agent definitions with optional configuration overrides.
 * Instantiates the orchestrator and all subagents, applying user config and defaults.
 *
 * @param config - Optional plugin configuration with agent overrides
 * @returns Array of agent definitions (orchestrator first, then subagents)
 */
export function createAgents(config?: PluginConfig, projectDir?: string): AgentDefinition[] {
  const getModelForAgent = (name: SubagentName): string => {
    if (name === '5-code-fixer') {
      return resolveAgentModel(config, name, [
        DEFAULT_MODELS['5-code-fixer'],
        DEFAULT_MODELS['3-docs-helper'],
      ]);
    }

    return resolveAgentModel(config, name, [DEFAULT_MODELS[name]]);
  };

  // 1. Gather all sub-agent definitions with custom prompts
  const protoSubAgents = (
    Object.entries(SUBAGENT_FACTORIES) as [SubagentName, AgentFactory][]
  ).map(([name, factory]) => {
    const customPrompts = loadAgentPrompt(name);
    return factory(
      getModelForAgent(name),
      customPrompts.prompt,
      customPrompts.appendPrompt,
    );
  });

  // 2. Apply overrides and default permissions to each agent
  const allSubAgents = protoSubAgents.map((agent) => {
    const override = getAgentOverride(config, agent.name);
    if (override) {
      applyOverrides(agent, override);
    }
    applyDefaultPermissions(agent, override?.skills);
    if (projectDir) {
      agent.config.prompt = `${soulPersonaLayer(projectDir)}\n\n${String(agent.config.prompt ?? '')}`;
    }
    return agent;
  });

  // 3. Create Orchestrator (with its own overrides and custom prompts)
  const orchestratorModel = resolveAgentModel(config, '1-task-manager', [
    DEFAULT_MODELS['1-task-manager'],
    DEFAULT_MODELS['4-architecture-advisor'],
    DEFAULT_MODELS['3-docs-helper'],
  ]);
  const orchestratorPrompts = loadAgentPrompt('1-task-manager');
  const orchestrator = createOrchestratorAgent(
    orchestratorModel,
    orchestratorPrompts.prompt,
    orchestratorPrompts.appendPrompt,
  );
  const oOverride = getAgentOverride(config, '1-task-manager');
  applyDefaultPermissions(orchestrator, oOverride?.skills);
  if (oOverride) {
    applyOverrides(orchestrator, oOverride);
  }
  if (projectDir) {
    orchestrator.config.prompt = `${soulPersonaLayer(projectDir)}\n\n${String(orchestrator.config.prompt ?? '')}`;
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
export function getAgentConfigs(
  config?: PluginConfig,
  projectDir?: string,
): Record<string, SDKAgentConfig> {
  const agents = createAgents(config, projectDir);
  return Object.fromEntries(
    agents.map((a) => {
      const sdkConfig: SDKAgentConfig & { mcps?: string[] } = {
        ...a.config,
        description: a.description,
        mcps: getAgentMcpList(a.name, config),
      };

      // Apply classification-based visibility and mode
      if (isSubagent(a.name)) {
        sdkConfig.mode = 'primary';
      } else if (a.name === '1-task-manager') {
        sdkConfig.mode = 'primary';
      }

      return [a.name, sdkConfig];
    }),
  );
}
