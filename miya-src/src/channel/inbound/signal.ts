import type { ChannelInboundMessage } from '../../channels/service';

export interface SignalWebhookBody {
  envelope?: {
    source?: string;
    sourceName?: string;
    dataMessage?: { message?: string };
  };
}

export function parseSignalInbound(
  body: SignalWebhookBody,
): ChannelInboundMessage | null {
  const senderID = String(body.envelope?.source ?? '').trim();
  const text = String(body.envelope?.dataMessage?.message ?? '').trim();
  if (!senderID || !text) return null;
  return {
    channel: 'signal',
    senderID,
    displayName: body.envelope?.sourceName ?? senderID,
    conversationID: senderID,
    text,
    raw: body,
  };
}
