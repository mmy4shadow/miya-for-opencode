import { describe, expect, test } from 'bun:test';
import {
  buildChannelConfig,
  parseDiscordInbound,
  parseGoogleChatInbound,
  parseIMessageInbound,
  parseSignalInbound,
  parseSlackInbound,
  parseTeamsInbound,
  parseTelegramInbound,
  parseWhatsappInbound,
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

    const whatsapp = parseWhatsappInbound({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '8613800', profile: { name: 'owner' } }],
                messages: [{ from: '8613800', text: { body: 'yo' } }],
              },
            },
          ],
        },
      ],
    });
    expect(whatsapp[0]?.channel).toBe('whatsapp');
    expect(whatsapp[0]?.displayName).toBe('owner');

    const gchat = parseGoogleChatInbound({
      message: {
        text: 'hello',
        sender: { name: 'users/123', displayName: 'chat-user' },
        thread: { name: 'spaces/abc/threads/1' },
      },
    });
    expect(gchat?.channel).toBe('google_chat');
    expect(gchat?.conversationID).toBe('spaces/abc/threads/1');

    const signal = parseSignalInbound({
      envelope: {
        source: '+8613',
        sourceName: 'sig',
        dataMessage: { message: 'hey' },
      },
    });
    expect(signal?.channel).toBe('signal');
    expect(signal?.senderID).toBe('+8613');

    const imessage = parseIMessageInbound({
      data: {
        text: 'msg',
        chatGuid: 'chat-guid',
        handle: { address: '+8611' },
        isFromMe: false,
      },
    });
    expect(imessage?.channel).toBe('imessage');
    expect(imessage?.conversationID).toBe('chat-guid');

    const teams = parseTeamsInbound({
      type: 'message',
      text: 'hi',
      from: { id: 'u1', name: 'name' },
      conversation: { id: 'c1' },
    });
    expect(teams?.channel).toBe('teams');
    expect(teams?.senderID).toBe('u1');
  });
});
