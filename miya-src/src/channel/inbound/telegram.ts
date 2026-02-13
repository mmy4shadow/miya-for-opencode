import type { ChannelInboundMessage } from '../../channels/service';

export interface TelegramWebhookBody {
  message?: {
    chat?: { id?: string | number };
    from?: { id?: string | number; username?: string; first_name?: string };
    text?: string;
  };
}

export function parseTelegramInbound(
  body: TelegramWebhookBody,
): ChannelInboundMessage | null {
  const message = body.message;
  if (!message?.text || !message.chat?.id || !message.from?.id) return null;
  return {
    channel: 'telegram',
    senderID: String(message.from.id),
    displayName:
      message.from.username ?? message.from.first_name ?? String(message.from.id),
    conversationID: String(message.chat.id),
    text: message.text,
    raw: body,
  };
}
