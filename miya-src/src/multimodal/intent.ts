export type MultimodalIntent =
  | { type: 'selfie'; prompt: string }
  | { type: 'voice_to_friend'; text: string; friend: string }
  | { type: 'unknown' };

function extractFriend(text: string): string {
  const bracket = text.match(/给\s*\[([^\]]+)\]/);
  if (bracket?.[1]) return bracket[1].trim();
  const plain = text.match(/给\s*([^\s，。!?！？]+)/);
  if (plain?.[1]) return plain[1].trim();
  return '';
}

export function detectMultimodalIntent(text: string): MultimodalIntent {
  const normalized = text.trim();
  if (!normalized) return { type: 'unknown' };

  if (/(发张自拍|来张自拍|自拍一下|自拍照)/.test(normalized)) {
    return {
      type: 'selfie',
      prompt: 'a natural selfie portrait, indoor soft light, realistic phone camera shot',
    };
  }

  if (/(用你的声音发一条语音给|发语音给|语音发给)/.test(normalized)) {
    const friend = extractFriend(normalized);
    return {
      type: 'voice_to_friend',
      text: normalized,
      friend,
    };
  }

  return { type: 'unknown' };
}
