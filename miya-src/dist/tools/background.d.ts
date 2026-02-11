import { type PluginInput, type ToolDefinition } from '@opencode-ai/plugin';
import type { BackgroundTaskManager } from '../background';
import type { PluginConfig } from '../config';
import type { TmuxConfig } from '../config/schema';
/**
 * Creates background task management tools for the plugin.
 * @param _ctx - Plugin input context
 * @param manager - Background task manager for launching and tracking tasks
 * @param _tmuxConfig - Optional tmux configuration for session management
 * @param _pluginConfig - Optional plugin configuration for agent variants
 * @returns Object containing background_task, background_output, and background_cancel tools
 */
export declare function createBackgroundTools(_ctx: PluginInput, manager: BackgroundTaskManager, _tmuxConfig?: TmuxConfig, _pluginConfig?: PluginConfig): Record<string, ToolDefinition>;
