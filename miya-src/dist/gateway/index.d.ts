import { type PluginInput, type ToolDefinition } from '@opencode-ai/plugin';
export type GatewayStatus = 'running' | 'killswitch';
export interface GatewayState {
    url: string;
    port: number;
    pid: number;
    startedAt: string;
    status: GatewayStatus;
}
export declare function ensureGatewayRunning(projectDir: string): GatewayState;
export declare function createGatewayTools(ctx: PluginInput): Record<string, ToolDefinition>;
export declare function startGatewayWithLog(projectDir: string): void;
