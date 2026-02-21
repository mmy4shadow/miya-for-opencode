import {
  normalizeAgentName,
  normalizeModelRef,
  persistAgentRuntimeSelection,
  readPersistedAgentRuntime,
  removePersistedAgentRuntimeSelection,
} from '../config/agent-model-persistence';
import { ALL_AGENT_NAMES, DEFAULT_MODELS } from '../config/constants';
import { isModelLikelyAvailable } from '../config/model-health';

export type AgentRuntimeModelHealth = 'healthy' | 'degraded' | 'unavailable';

export interface AgentRuntimeModelState {
  agentName: string;
  model: string;
  providerID?: string;
  variant?: string;
  updatedAt: string;
  source: 'runtime' | 'default';
  active: boolean;
  healthStatus: AgentRuntimeModelHealth;
}

export class AgentModelRuntimeApi {
  constructor(private readonly projectDir: string) {}

  list() {
    const runtime = readPersistedAgentRuntime(this.projectDir);
    const agents: AgentRuntimeModelState[] = [];

    for (const agentName of ALL_AGENT_NAMES) {
      const entry = runtime.agents[agentName];
      const model = entry?.model ?? DEFAULT_MODELS[agentName];
      const source: 'runtime' | 'default' = entry?.model
        ? 'runtime'
        : 'default';
      agents.push({
        agentName,
        model,
        providerID: entry?.providerID,
        variant: entry?.variant,
        updatedAt: entry?.updatedAt ?? '',
        source,
        active: runtime.activeAgentId === agentName,
        healthStatus: this.resolveHealthStatus(model),
      });
    }

    return {
      activeAgentId: runtime.activeAgentId,
      revision: runtime.revision,
      agents,
    };
  }

  set(input: {
    agentName: string;
    model: unknown;
    variant?: unknown;
    providerID?: unknown;
    options?: unknown;
    apiKey?: unknown;
    baseURL?: unknown;
    activate?: boolean;
  }): { changed: boolean } {
    const agentName = normalizeAgentName(input.agentName);
    if (!agentName) {
      throw new Error('invalid_agent_name');
    }
    if (!normalizeModelRef(input.model)) {
      throw new Error('invalid_model_ref');
    }

    const changed = persistAgentRuntimeSelection(this.projectDir, {
      agentName,
      model: input.model,
      variant: input.variant,
      providerID: input.providerID,
      options: input.options,
      apiKey: input.apiKey,
      baseURL: input.baseURL,
      activeAgentId: input.activate === false ? undefined : agentName,
    });
    return { changed };
  }

  reset(input: {
    agentName: string;
    clearActive?: boolean;
    activeAgentId?: string;
  }): { changed: boolean } {
    const changed = removePersistedAgentRuntimeSelection(
      this.projectDir,
      input.agentName,
      {
        clearActive: input.clearActive ?? true,
        activeAgentId: input.activeAgentId,
      },
    );
    return { changed };
  }

  private resolveHealthStatus(model: string): AgentRuntimeModelHealth {
    if (!model) return 'unavailable';
    return isModelLikelyAvailable(model) ? 'healthy' : 'degraded';
  }
}
