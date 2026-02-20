import type { McpConfig } from './types';
export type { LocalMcpConfig, McpConfig, RemoteMcpConfig } from './types';
/**
 * Creates MCP configurations, excluding disabled ones
 */
export declare function createBuiltinMcps(disabledMcps?: readonly string[]): Record<string, McpConfig>;
export declare function buildMcpServiceManifest(disabledMcps?: readonly string[]): {
    service: string;
    version: number;
    generatedAt: string;
    mcps: Array<{
        name: string;
        type: string;
        sampling: boolean;
        mcpUi: boolean;
        serviceExpose: boolean;
    }>;
    controlPlaneEndpoints: string[];
};
