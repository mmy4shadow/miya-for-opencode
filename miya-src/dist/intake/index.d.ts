import type { ToolDefinition } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import { intakeSummary, listIntakeData } from './service';
export declare function createIntakeTools(ctx: PluginInput): Record<string, ToolDefinition>;
export { intakeSummary, listIntakeData, };
