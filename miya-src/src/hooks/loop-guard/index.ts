import {
  getSessionState,
  isNegativeConfirmation,
  resetSessionState,
  setSessionState,
  shouldEnableStrictQualityGate,
} from '../../workflow';

interface MessageInfo {
  role: string;
  agent?: string;
  sessionID?: string;
}

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

function getAllText(message: MessageWithParts): string {
  return message.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n');
}

function hasQualityGatePass(messages: MessageWithParts[]): boolean {
  return messages.some((message) => getAllText(message).includes('QUALITY_GATE=PASS'));
}

function isCompletionIntent(text: string): boolean {
  const lowered = text.toLowerCase();
  const keywords = [
    'done',
    'finish',
    'final',
    'complete',
    'ship',
    'close',
    '结束',
    '完成',
    '收尾',
    '交付',
  ];
  return keywords.some((keyword) => lowered.includes(keyword));
}

function findLastUserMessage(messages: MessageWithParts[]): {
  index: number;
  message: MessageWithParts;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === 'user') {
      return { index: i, message: messages[i] };
    }
  }
  return null;
}

function findTextPartIndex(parts: MessagePart[]): number {
  return parts.findIndex((part) => part.type === 'text' && part.text !== undefined);
}

export function createLoopGuardHook(projectDir: string) {
  return {
    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      const lastUser = findLastUserMessage(output.messages);
      if (!lastUser) return;

      const agent = lastUser.message.info.agent;
      if (agent && agent !== '1-task-manager') {
        return;
      }

      const textPartIndex = findTextPartIndex(lastUser.message.parts);
      if (textPartIndex === -1) {
        return;
      }

      const sessionID = lastUser.message.info.sessionID ?? 'main';
      const originalText = lastUser.message.parts[textPartIndex].text ?? '';
      const normalizedText = originalText.trim();

      const state = getSessionState(projectDir, sessionID);

      // Explicit cancel command resets loop state immediately.
      if (isNegativeConfirmation(normalizedText) || normalizedText === 'cancel-work') {
        resetSessionState(projectDir, sessionID);
        lastUser.message.parts[textPartIndex].text = `[MIYA LOOP CANCELED]\nOutput a concise final status only:\n<loop_report>\n- done: completed work\n- missing: remaining required work\n- unresolved: still broken/risky parts\n</loop_report>`;
        return;
      }

      // No human confirmation path in autopilot mode: open next loop window silently.
      if (state.loopEnabled && state.awaitingConfirmation) {
        state.awaitingConfirmation = false;
        state.windowStartIteration = state.iterationCompleted;
      }

      // Strict quality mode toggles.
      const lowered = normalizedText.toLowerCase();
      if (shouldEnableStrictQualityGate(normalizedText)) {
        state.strictQualityGate = true;
      }
      if (
        lowered.includes('strict-quality-gate off') ||
        lowered.includes('strict quality gate off')
      ) {
        state.strictQualityGate = false;
      }

      if (
        state.strictQualityGate &&
        isCompletionIntent(normalizedText) &&
        !hasQualityGatePass(output.messages)
      ) {
        setSessionState(projectDir, sessionID, state);
        lastUser.message.parts[textPartIndex].text = `[MIYA STRICT QUALITY GATE BLOCK]\nCompletion is blocked because QUALITY_GATE=PASS was not found.\nCall tool \`quality_gate\` with architecture_score, docs_score, and domain_score.\nProceed only after QUALITY_GATE=PASS.`;
        return;
      }

      // Persist state and prepend strict gate runtime rule when enabled.
      setSessionState(projectDir, sessionID, state);

      if (state.strictQualityGate) {
        lastUser.message.parts[textPartIndex].text = `[MIYA STRICT QUALITY GATE ACTIVE]\nBefore declaring completion, call tool \`quality_gate\` and require QUALITY_GATE=PASS.\n\n---\n\n${originalText}`;
      }
    },
  };
}
