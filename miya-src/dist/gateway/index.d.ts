import { type PluginInput, type ToolDefinition } from '@opencode-ai/plugin';
import type { MiyaAutomationService } from '../automation';
import type { BackgroundTaskManager } from '../background';
export type GatewayStatus = 'running' | 'killswitch';
export interface GatewayState {
    url: string;
    port: number;
    pid: number;
    startedAt: string;
    status: GatewayStatus;
}
interface GatewayDependencies {
    client?: PluginInput['client'];
    automationService?: MiyaAutomationService;
    backgroundManager?: BackgroundTaskManager;
    extraSkillDirs?: string[];
}
export declare function registerGatewayDependencies(projectDir: string, deps: GatewayDependencies): void;
export declare function stopGateway(projectDir: string): {
    stopped: boolean;
    previous?: GatewayState;
};
export declare function ensureGatewayRunning(projectDir: string): GatewayState;
export declare function createGatewayTools(ctx: PluginInput): Record<string, ToolDefinition>;
export declare function startGatewayWithLog(projectDir: string): void;
export {};
