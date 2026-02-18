import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { intakeSummary, listIntakeData } from './service';
export declare function createIntakeTools(ctx: PluginInput): Record<string, ToolDefinition>;
export { intakeSummary, listIntakeData };
