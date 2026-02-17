import type { AgentConfig } from '@opencode-ai/sdk';
export interface AgentDefinition {
    name: string;
    description?: string;
    config: AgentConfig;
    personaStyle: 'full' | 'minimal' | 'zero';
}
export declare function createOrchestratorAgent(model: string, customPrompt?: string, customAppendPrompt?: string, useSlimPrompt?: boolean): AgentDefinition;
