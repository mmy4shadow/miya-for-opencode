import type { ChannelInboundMessage } from '../../channels/service';

export interface SlackWebhookBody {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    user?: string;
    text?: string;
    channel?: string;
    bot_id?: string;
  };
}

export function parseSlackInbound(
  body: SlackWebhookBody,
): ChannelInboundMessage | null {
  if (
    body.event?.type !== 'message' ||
    !body.event.user ||
    !body.event.text ||
    !body.event.channel ||
    body.event.bot_id
  ) {
    return null;
  }
  return {
    channel: 'slack',
    senderID: body.event.user,
    displayName: body.event.user,
    conversationID: body.event.channel,
    text: body.event.text,
    raw: body,
  };
}
