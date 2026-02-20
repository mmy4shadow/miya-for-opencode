export type RemoteMcpConfig = {
    type: 'remote';
    url: string;
    headers?: Record<string, string>;
    oauth?: false;
    capabilities?: {
        sampling?: boolean;
        mcpUi?: boolean;
    };
};
export type LocalMcpConfig = {
    type: 'local';
    command: string[];
    environment?: Record<string, string>;
    capabilities?: {
        sampling?: boolean;
        mcpUi?: boolean;
        serviceExpose?: boolean;
    };
};
export type McpConfig = RemoteMcpConfig | LocalMcpConfig;
