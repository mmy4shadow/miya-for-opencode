import { type PluginInput, type ToolDefinition } from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
export declare function createUltraworkTools(_ctx: PluginInput, manager: BackgroundTaskManager): Record<string, ToolDefinition>;
