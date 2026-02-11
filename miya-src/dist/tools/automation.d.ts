import { type ToolDefinition } from '@opencode-ai/plugin';
import type { MiyaAutomationService } from '../automation';
export declare function createAutomationTools(automationService: MiyaAutomationService): Record<string, ToolDefinition>;
