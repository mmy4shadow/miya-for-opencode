import type { AgentConfig } from '@opencode-ai/sdk';
export interface BaseAgentDefinition {
    name: string;
    description?: string;
    config: AgentConfig;
    personaStyle: PersonaStyle;
}
type PersonaStyle = 'full' | 'minimal' | 'zero';
export interface BaseAgentOptions {
    name: string;
    description: string;
    defaultTemperature: number;
    basePrompt: string;
    personaStyle: PersonaStyle;
}
export declare class BaseAgent {
    private readonly options;
    constructor(options: BaseAgentOptions);
    create(model: string, customPrompt?: string, customAppendPrompt?: string): BaseAgentDefinition;
}
export {};
