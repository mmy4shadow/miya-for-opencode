interface MessageInfo {
  role: string;
  agent?: string;
}

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

type BridgePromptFactory = (argumentsText: string) => string;

const BRIDGE_PROMPTS: Record<string, BridgePromptFactory> = {
  'miya-gateway-start': () =>
    'MANDATORY: Call tool `miya_gateway_start` exactly once. Return only tool output. If tool call fails, return exact error text.',
  miya_gateway_start: () =>
    'MANDATORY: Call tool `miya_gateway_start` exactly once. Return only tool output. If tool call fails, return exact error text.',
  'miya.gateway.start': () =>
    'MANDATORY: Call tool `miya_gateway_start` exactly once. Return only tool output. If tool call fails, return exact error text.',
  'miya-gateway-status': () =>
    'MANDATORY: Call tool `miya_gateway_status` exactly once. Return only tool output.',
  miya_gateway_status: () =>
    'MANDATORY: Call tool `miya_gateway_status` exactly once. Return only tool output.',
  'miya-ui-open': () =>
    'MANDATORY: Call tool `miya_ui_open` exactly once. Return only tool output.',
  miya_ui_open: () =>
    'MANDATORY: Call tool `miya_ui_open` exactly once. Return only tool output.',
};

function extractSlashCommand(text: string): {
  name: string;
  argumentsText: string;
} | null {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!firstLine.startsWith('/')) return null;
  const body = firstLine.slice(1).trim();
  if (!body) return null;
  const [name = '', ...rest] = body.split(/\s+/);
  if (!name) return null;
  return {
    name,
    argumentsText: rest.join(' ').trim(),
  };
}

function findLastUserTextPart(messages: MessageWithParts[]): {
  message: MessageWithParts;
  textPartIndex: number;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.info.role !== 'user') continue;
    if (message.info.agent && message.info.agent !== '1-task-manager') continue;
    const textPartIndex = message.parts.findIndex(
      (part) => part.type === 'text' && part.text !== undefined,
    );
    if (textPartIndex === -1) continue;
    return { message, textPartIndex };
  }
  return null;
}

export function createSlashCommandBridgeHook() {
  return {
    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      const target = findLastUserTextPart(output.messages);
      if (!target) return;

      const originalText =
        target.message.parts[target.textPartIndex].text ?? '';
      const slashCommand = extractSlashCommand(originalText);
      if (!slashCommand) return;

      const promptFactory = BRIDGE_PROMPTS[slashCommand.name];
      if (!promptFactory) return;

      const commandPrompt = promptFactory(slashCommand.argumentsText);
      target.message.parts[target.textPartIndex].text =
        `[MIYA COMMAND BRIDGE]\n${commandPrompt}`;
    },
  };
}
