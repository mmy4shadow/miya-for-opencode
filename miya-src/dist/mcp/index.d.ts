import type { McpConfig } from './types';
export type { LocalMcpConfig, McpConfig, RemoteMcpConfig } from './types';
/**
 * Creates MCP configurations, excluding disabled ones
 */
export declare function createBuiltinMcps(disabledMcps?: readonly string[]): Record<string, McpConfig>;
