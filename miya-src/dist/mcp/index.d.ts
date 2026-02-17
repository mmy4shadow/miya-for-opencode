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
        native: boolean;
        authMode: 'none' | 'header' | 'oauth';
        ecosystem: 'core' | 'community';
        tags: string[];
        authConfigured: boolean;
    }>;
    summary: {
        total: number;
        serviceExpose: number;
        native: number;
        authConfigured: number;
        byEcosystem: {
            core: number;
            community: number;
        };
    };
    controlPlaneEndpoints: string[];
};
export declare function summarizeMcpEcosystem(disabledMcps?: readonly string[]): string;
