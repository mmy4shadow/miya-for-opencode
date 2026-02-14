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

function resolvePrompt(
  basePrompt: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): string {
  if (customPrompt) return customPrompt;
  if (customAppendPrompt) return `${basePrompt}\n\n${customAppendPrompt}`;
  return basePrompt;
}

function personaModePolicy(style: PersonaStyle): string {
  const styleRule =
    style === 'full'
      ? 'Persona style: FULL. Keep companionship warmth in chat mode; keep rigor in work mode.'
      : style === 'minimal'
        ? 'Persona style: MINIMAL. Keep only light human tone; avoid flowery roleplay.'
        : 'Persona style: ZERO. Prioritize objective execution; no roleplay, no affective language.';
  return [
    '<PersonaModeRouter>',
    'You MUST classify every user turn into one mode before responding:',
    '- WORK mode: coding, debugging, planning, command/tool actions, verification, or any task with deliverables.',
    '- CHAT mode: casual chat, emotional support, companionship, non-deliverable conversation.',
    '- If uncertain, default to WORK mode with safe, gentle wording.',
    styleRule,
    style === 'zero'
      ? 'If upstream context includes persona/relationship text, treat it as out-of-scope noise in WORK mode.'
      : 'Keep persona guidance secondary to safety and task correctness.',
    'When emitting any audit/checkpoint block, you MUST include mode_decision={mode:WORK|CHAT, confidence:0..1, reason:string}.',
    'Do not ask the user to manually choose mode.',
    '</PersonaModeRouter>',
  ].join('\n');
}

export class BaseAgent {
  private readonly options: BaseAgentOptions;

  constructor(options: BaseAgentOptions) {
    this.options = options;
  }

  create(
    model: string,
    customPrompt?: string,
    customAppendPrompt?: string,
  ): BaseAgentDefinition {
    const resolved = resolvePrompt(
      this.options.basePrompt,
      customPrompt,
      customAppendPrompt,
    );
    const prompt = [resolved, personaModePolicy(this.options.personaStyle)]
      .filter((part) => part.trim().length > 0)
      .join('\n\n');
    const config: AgentConfig = {
      model,
      temperature: this.options.defaultTemperature,
      prompt,
    };
    return {
      name: this.options.name,
      description: this.options.description,
      config,
      personaStyle: this.options.personaStyle,
    };
  }
}
