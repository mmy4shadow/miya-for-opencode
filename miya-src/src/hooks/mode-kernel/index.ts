import { evaluateModeKernel } from '../../gateway/mode-kernel';
import { applyModeSafeWorkFallback } from '../../context/pipeline';
import {
  extractUserIntentText,
  findLastUserTextPart,
  hasBlock,
  isCommandBridgeText,
  prependBlock,
  type MessageWithParts,
} from '../neural-chain/shared';

interface ModeKernelHookConfig {
  enabled?: boolean;
  minConfidenceForSafeMode?: number;
}

function resolveConfig(input?: ModeKernelHookConfig): Required<ModeKernelHookConfig> {
  return {
    enabled: input?.enabled ?? true,
    minConfidenceForSafeMode: Math.max(
      0,
      Math.min(1, Number(input?.minConfidenceForSafeMode ?? 0.5)),
    ),
  };
}

function toReasonLine(reasons: string[]): string {
  return reasons.map((item) => item.trim()).filter(Boolean).slice(0, 8).join('|') || 'none';
}

export function createModeKernelHook(rawConfig?: ModeKernelHookConfig) {
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
      if (hasBlock(currentText, '[MIYA_MODE_KERNEL v1]')) return;

      const intentText = extractUserIntentText(currentText);
      if (!intentText) return;

      const modeKernelRaw = evaluateModeKernel({
        text: intentText,
      });
      const { modeKernel, lowConfidenceSafeFallback } = applyModeSafeWorkFallback(
        modeKernelRaw,
        config.minConfidenceForSafeMode,
      );

      const block = [
        '[MIYA_MODE_KERNEL v1]',
        `mode=${modeKernel.mode}`,
        `confidence=${Number(modeKernel.confidence).toFixed(3)}`,
        `why=${toReasonLine(modeKernel.why)}`,
        lowConfidenceSafeFallback
          ? `safety_fallback=mode:work source_mode:${modeKernelRaw.mode} source_confidence:${Number(modeKernelRaw.confidence).toFixed(3)}`
          : '',
        '[/MIYA_MODE_KERNEL]',
      ]
        .filter(Boolean)
        .join('\n');

      target.message.parts[target.partIndex].text = prependBlock(block, currentText);
    },
  };
}
