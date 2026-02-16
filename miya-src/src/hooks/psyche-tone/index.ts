import { evaluateModeKernel } from '../../gateway/mode-kernel';
import {
  extractUserIntentText,
  findLastUserTextPart,
  hasBlock,
  isCommandBridgeText,
  parseModeKernelMeta,
  prependBlock,
  type MessageWithParts,
} from '../neural-chain/shared';

interface PsycheToneConfig {
  enabled?: boolean;
}

function resolveMode(text: string): 'work' | 'chat' | 'mixed' {
  const parsed = parseModeKernelMeta(text);
  if (parsed) return parsed.mode;
  const raw = evaluateModeKernel({
    text: extractUserIntentText(text) || text,
  });
  return raw.confidence < 0.5 ? 'work' : raw.mode;
}

function inferToneProfile(text: string): {
  tone: 'supportive' | 'warm' | 'calm';
  reason: string;
} {
  const normalized = text.toLowerCase();
  if (/(难受|焦虑|崩溃|害怕|沮丧|失眠|孤独|累死|心烦|sad|anxious|panic|overwhelmed)/i.test(normalized)) {
    return {
      tone: 'supportive',
      reason: 'emotion_signal=stress',
    };
  }
  if (/(开心|高兴|激动|期待|喜欢|甜|可爱|happy|excited|love)/i.test(normalized)) {
    return {
      tone: 'warm',
      reason: 'emotion_signal=positive',
    };
  }
  return {
    tone: 'calm',
    reason: 'emotion_signal=neutral',
  };
}

function resolveConfig(input?: PsycheToneConfig): Required<PsycheToneConfig> {
  return {
    enabled: input?.enabled ?? true,
  };
}

export function createPsycheToneHook(rawConfig?: PsycheToneConfig) {
  const config = resolveConfig(rawConfig);
  return {
    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      if (!config.enabled) return;
      const target = findLastUserTextPart(output.messages);
      if (!target) return;

      const currentText = String(target.message.parts[target.partIndex].text ?? '');
      if (!currentText.trim()) return;
      if (isCommandBridgeText(currentText)) return;
      if (hasBlock(currentText, '[MIYA_PSYCHE_TONE v1]')) return;

      const mode = resolveMode(currentText);
      if (mode === 'work') return;

      const intentText = extractUserIntentText(currentText) || currentText;
      const profile = inferToneProfile(intentText);
      const style =
        mode === 'mixed'
          ? [
              '- 先给执行结论，再补一句情感回应。',
              '- 情绪回应控制在 1-2 句，避免覆盖任务信息。',
              '- 使用温和、稳定、简短的中文表达。',
            ]
          : [
              '- 先回应情绪，再给一句可执行的小建议。',
              '- 语气温柔，避免工程化术语。',
              '- 允许适度陪伴表达，但保持边界。',
            ];

      const block = [
        '[MIYA_PSYCHE_TONE v1]',
        `mode=${mode}`,
        `tone=${profile.tone}`,
        `reason=${profile.reason}`,
        'style:',
        ...style,
        'boundaries:',
        '- Do not override execution permissions, safety gates, or policy checks.',
        '[/MIYA_PSYCHE_TONE]',
      ].join('\n');

      target.message.parts[target.partIndex].text = prependBlock(block, currentText);
    },
  };
}
