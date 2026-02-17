export interface McpCapabilities {
    sampling?: boolean;
    mcpUi?: boolean;
    serviceExpose?: boolean;
    native?: boolean;
    authMode?: 'none' | 'header' | 'oauth';
    ecosystem?: 'core' | 'community';
    tags?: string[];
}
export type RemoteMcpConfig = {
    type: 'remote';
    url: string;
    headers?: Record<string, string>;
    oauth?: false;
    capabilities?: McpCapabilities;
};
export type LocalMcpConfig = {
    type: 'local';
    command: string[];
    environment?: Record<string, string>;
    capabilities?: McpCapabilities;
};
export type McpConfig = RemoteMcpConfig | LocalMcpConfig;
