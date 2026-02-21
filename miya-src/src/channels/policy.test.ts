import { describe, expect, test } from 'vitest';
import {
  assertChannelCanSend,
  canChannelSend,
  getChannelDirection,
} from './policy';

describe('channel policy', () => {
  test('only qq and wechat are outbound-allowlist', () => {
    expect(getChannelDirection('qq')).toBe('OUTBOUND_ALLOWLIST');
    expect(getChannelDirection('wechat')).toBe('OUTBOUND_ALLOWLIST');
    expect(getChannelDirection('telegram')).toBe('INBOUND_ONLY');
    expect(canChannelSend('qq')).toBe(true);
    expect(canChannelSend('wechat')).toBe(true);
    expect(canChannelSend('slack')).toBe(false);
  });

  test('inbound-only channels throw when sending', () => {
    expect(() => assertChannelCanSend('telegram')).toThrow(
      /channel_send_blocked:telegram/,
    );
  });
});
