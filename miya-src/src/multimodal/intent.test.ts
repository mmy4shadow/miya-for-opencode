import { describe, expect, test } from 'vitest';
import { detectMultimodalIntent } from './intent';

describe('multimodal intent', () => {
  test('detects selfie intent', () => {
    const intent = detectMultimodalIntent('发张自拍');
    expect(intent.type).toBe('selfie');
  });

  test('detects voice-to-friend intent', () => {
    const intent = detectMultimodalIntent('用你的声音发一条语音给[朋友]');
    expect(intent.type).toBe('voice_to_friend');
    if (intent.type === 'voice_to_friend') {
      expect(intent.friend).toBe('朋友');
    }
  });
});
