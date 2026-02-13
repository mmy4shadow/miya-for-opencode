import { describe, expect, test } from 'bun:test';
import {
  buildChannelConfig,
  parseDiscordInbound,
  parseSlackInbound,
  parseTelegramInbound,
} from './index';

describe('channel planning facade', () => {
  test('buildChannelConfig follows direction policy', () => {
    expect(buildChannelConfig('qq').allowSend).toBe(true);
    expect(buildChannelConfig('qq').allowReceive).toBe(false);
    expect(buildChannelConfig('telegram').allowSend).toBe(false);
    expect(buildChannelConfig('telegram').allowReceive).toBe(true);
  });

  test('parses inbound webhook payloads', () => {
    const telegram = parseTelegramInbound({
      message: {
        chat: { id: 123 },
        from: { id: 456, username: 'tg-user' },
        text: 'hello',
      },
    });
    expect(telegram?.channel).toBe('telegram');
    expect(telegram?.senderID).toBe('456');

    const slack = parseSlackInbound({
      event: {
        type: 'message',
        user: 'U1',
        channel: 'C1',
        text: 'ping',
      },
    });
    expect(slack?.channel).toBe('slack');
    expect(slack?.conversationID).toBe('C1');

    const discord = parseDiscordInbound({
      content: 'pong',
      channel_id: 'D1',
      author: { id: 'A1', username: 'user' },
    });
    expect(discord?.channel).toBe('discord');
    expect(discord?.senderID).toBe('A1');
  });
});
