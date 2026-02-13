import type { PluginConfig } from './schema';
export declare function normalizeAgentName(name: string): string | null;
export declare function normalizeModelRef(value: unknown): string | null;
export declare function readPersistedAgentModels(projectDir: string): Record<string, string>;
export declare function persistAgentModelSelection(projectDir: string, agentName: string, model: unknown): boolean;
export declare function applyPersistedAgentModelOverrides(config: PluginConfig, projectDir: string): PluginConfig;
export declare function extractAgentModelSelectionFromEvent(event: unknown): {
    agentName: string;
    model: string;
    source: string;
} | null;
