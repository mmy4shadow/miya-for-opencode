import { ALL_AGENT_NAMES, ORCHESTRATOR_NAME } from '../../config/constants';
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

const SUBAGENT_NAMES = ALL_AGENT_NAMES.filter(
  (name) => name !== ORCHESTRATOR_NAME,
);

function getAllText(message: MessageWithParts): string {
  return message.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n');
}

function hasQualityGatePass(messages: MessageWithParts[]): boolean {
  return messages.some((message) =>
    getAllText(message).includes('QUALITY_GATE=PASS'),
  );
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
  return parts.findIndex(
    (part) => part.type === 'text' && part.text !== undefined,
  );
}

function isDirectAgentSelection(agent: string | undefined): boolean {
  if (!agent) return false;
  return SUBAGENT_NAMES.includes(agent as (typeof SUBAGENT_NAMES)[number]);
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
      const sessionID = lastUser.message.info.sessionID ?? 'main';
      const textPartIndex = findTextPartIndex(lastUser.message.parts);
      if (textPartIndex === -1) return;

      const originalText = lastUser.message.parts[textPartIndex].text ?? '';
      const normalizedText = originalText.trim();
      const state = getSessionState(projectDir, sessionID);

      // Explicit cancel command resets loop state immediately.
      if (
        isNegativeConfirmation(normalizedText) ||
        normalizedText === 'cancel-work'
      ) {
        resetSessionState(projectDir, sessionID);
        lastUser.message.parts[textPartIndex].text =
          `[MIYA LOOP CANCELED]\nOutput a concise final status only:\n<loop_report>\n- done: completed work\n- missing: remaining required work\n- unresolved: still broken/risky parts\n</loop_report>`;
        return;
      }

      // DIRECT AGENT MODE: User directly selected a subagent (not task-manager)
      // In this mode, the agent executes immediately without full 6-step workflow
      if (isDirectAgentSelection(agent)) {
        // Check loop limit (don't increment here - let miya_iteration_done handle counting)
        const window = Math.max(
          0,
          state.iterationCompleted - state.windowStartIteration,
        );

        if (state.loopEnabled && window >= state.maxIterationsPerWindow) {
          // Loop limit reached - output report and stop
          lastUser.message.parts[textPartIndex].text =
            `[MIYA DIRECT MODE - LOOP LIMIT REACHED]\nThis is iteration ${state.iterationCompleted} (limit: ${state.maxIterationsPerWindow}).\n\n<loop_report>\n- done: ${state.lastDone.join(', ') || '(none recorded)'}\n- missing: ${state.lastMissing.join(', ') || '(none recorded)'}\n- unresolved: ${state.lastUnresolved.join(', ') || '(none recorded)'}\n</loop_report>\n\n${originalText}`;
          return;
        }

        // Add direct mode indicator but don't block execution
        if (!originalText.includes('[MIYA DIRECT MODE]')) {
          lastUser.message.parts[textPartIndex].text =
            `[MIYA DIRECT MODE: ${agent}]\n你正在使用直接模式 - 立即使用你的专业能力执行，无需等待完整6步工作流。\n当前循环: ${state.iterationCompleted}/${state.maxIterationsPerWindow}。\n\n${originalText}`;
        }

        // Note: We DON'T increment iteration here - that's handled by miya_iteration_done tool
        // This prevents double-counting
        return;
      }

      // Standard mode: only process for task-manager
      if (agent && agent !== ORCHESTRATOR_NAME) {
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
        lastUser.message.parts[textPartIndex].text =
          `[MIYA STRICT QUALITY GATE BLOCK]\nCompletion is blocked because QUALITY_GATE=PASS was not found.\nCall tool \`quality_gate\` with architecture_score, docs_score, and domain_score.\nProceed only after QUALITY_GATE=PASS.`;
        return;
      }

      // Persist state and prepend strict gate runtime rule when enabled.
      setSessionState(projectDir, sessionID, state);

      if (state.strictQualityGate) {
        lastUser.message.parts[textPartIndex].text =
          `[MIYA STRICT QUALITY GATE ACTIVE]\nBefore declaring completion, call tool \`quality_gate\` and require QUALITY_GATE=PASS.\n\n---\n\n${originalText}`;
      }
    },
  };
}
