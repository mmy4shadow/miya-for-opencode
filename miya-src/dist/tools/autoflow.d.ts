import { type ToolDefinition } from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
export declare function createAutoflowTools(projectDir: string, manager: BackgroundTaskManager): Record<string, ToolDefinition>;
