type GenericRecord = Record<string, unknown>;
/**
 * Merge plugin agent defaults into an existing OpenCode agent map without
 * clobbering user overrides (especially per-agent model selections).
 */
export declare function mergePluginAgentConfigs(existingAgents: GenericRecord | undefined, pluginAgents: Record<string, GenericRecord>): Record<string, GenericRecord>;
export {};
