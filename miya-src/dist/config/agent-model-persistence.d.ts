import type { PluginConfig } from './schema';
interface AgentRuntimeEntry {
    model?: string;
    variant?: string;
    providerID?: string;
    options?: Record<string, unknown>;
    apiKey?: string;
    baseURL?: string;
    updatedAt: string;
}
export interface AgentRuntimeSelectionInput {
    agentName: string;
    model?: unknown;
    variant?: unknown;
    providerID?: unknown;
    options?: unknown;
    apiKey?: unknown;
    baseURL?: unknown;
    activeAgentId?: unknown;
}
export interface AgentModelSelectionFromEvent {
    agentName: string;
    model?: string;
    variant?: string;
    providerID?: string;
    options?: Record<string, unknown>;
    apiKey?: string;
    baseURL?: string;
    activeAgentId?: string;
    source: string;
}
export declare function normalizeAgentName(name: string): string | null;
export declare function normalizeModelRef(value: unknown): string | null;
export declare function readPersistedAgentModels(projectDir: string): Record<string, string>;
export declare function readPersistedAgentRuntime(projectDir: string): {
    activeAgentId?: string;
    revision: number;
    agents: Record<string, AgentRuntimeEntry>;
};
export declare function persistAgentRuntimeSelection(projectDir: string, input: AgentRuntimeSelectionInput): boolean;
export declare function persistAgentModelSelection(projectDir: string, agentName: string, model: unknown): boolean;
export declare function applyPersistedAgentModelOverrides(config: PluginConfig, projectDir: string): PluginConfig;
export declare function extractAgentModelSelectionFromEvent(event: unknown): AgentModelSelectionFromEvent | null;
export declare function extractAgentModelSelectionsFromEvent(event: unknown): AgentModelSelectionFromEvent[];
export {};
