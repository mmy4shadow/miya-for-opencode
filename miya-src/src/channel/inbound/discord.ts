import type { ChannelInboundMessage } from '../../channels/service';

export interface DiscordWebhookBody {
  content?: string;
  channel_id?: string;
  author?: { id?: string; username?: string; bot?: boolean };
}

export function parseDiscordInbound(
  body: DiscordWebhookBody,
): ChannelInboundMessage | null {
  if (!body.content || !body.channel_id || !body.author?.id || body.author?.bot) {
    return null;
  }
  return {
    channel: 'discord',
    senderID: body.author.id,
    displayName: body.author.username ?? body.author.id,
    conversationID: body.channel_id,
    text: body.content,
    raw: body,
  };
}
