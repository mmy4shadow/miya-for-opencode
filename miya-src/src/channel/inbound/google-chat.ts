import type { ChannelInboundMessage } from '../../channels/service';

export interface GoogleChatWebhookBody {
  message?: {
    text?: string;
    sender?: { name?: string; displayName?: string };
    space?: { name?: string };
    thread?: { name?: string };
  };
}

export function parseGoogleChatInbound(
  body: GoogleChatWebhookBody,
): ChannelInboundMessage | null {
  const text = String(body.message?.text ?? '').trim();
  const senderID = String(body.message?.sender?.name ?? '').trim();
  const conversationID = String(
    body.message?.thread?.name ?? body.message?.space?.name ?? '',
  ).trim();
  if (!text || !senderID || !conversationID) return null;
  return {
    channel: 'google_chat',
    senderID,
    displayName: body.message?.sender?.displayName ?? senderID,
    conversationID,
    text,
    raw: body,
  };
}
