import type { ChannelInboundMessage } from '../../channels/service';

export interface IMessageWebhookBody {
  data?: {
    text?: string;
    chatGuid?: string;
    handle?: { address?: string };
    isFromMe?: boolean;
    displayName?: string;
  };
}

export function parseIMessageInbound(
  body: IMessageWebhookBody,
): ChannelInboundMessage | null {
  if (body.data?.isFromMe) return null;
  const text = String(body.data?.text ?? '').trim();
  const senderID = String(body.data?.handle?.address ?? '').trim();
  const conversationID = String(body.data?.chatGuid ?? '').trim();
  if (!text || !senderID || !conversationID) return null;
  return {
    channel: 'imessage',
    senderID,
    displayName: body.data?.displayName ?? senderID,
    conversationID,
    text,
    raw: body,
  };
}
