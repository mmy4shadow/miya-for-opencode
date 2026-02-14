import type { ChannelInboundMessage } from '../../channels/service';

export interface TeamsWebhookBody {
  type?: string;
  text?: string;
  from?: { id?: string; name?: string };
  conversation?: { id?: string };
}

export function parseTeamsInbound(
  body: TeamsWebhookBody,
): ChannelInboundMessage | null {
  if (body.type !== 'message') return null;
  const text = String(body.text ?? '').trim();
  const senderID = String(body.from?.id ?? '').trim();
  const conversationID = String(body.conversation?.id ?? '').trim();
  if (!text || !senderID || !conversationID) return null;
  return {
    channel: 'teams',
    senderID,
    displayName: body.from?.name ?? senderID,
    conversationID,
    text,
    raw: body,
  };
}
