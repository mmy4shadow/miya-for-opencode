import type { ChannelInboundMessage } from '../../channels/service';

export interface WhatsAppWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{ from?: string; text?: { body?: string } }>;
      };
    }>;
  }>;
}

export function parseWhatsappInbound(
  body: WhatsAppWebhookBody,
): ChannelInboundMessage[] {
  const messages: ChannelInboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contactMap = new Map(
        (value?.contacts ?? []).map((contact) => [
          String(contact.wa_id ?? ''),
          contact.profile?.name,
        ]),
      );
      for (const message of value?.messages ?? []) {
        const senderID = String(message.from ?? '').trim();
        const text = String(message.text?.body ?? '').trim();
        if (!senderID || !text) continue;
        messages.push({
          channel: 'whatsapp',
          senderID,
          displayName: contactMap.get(senderID) ?? senderID,
          conversationID: senderID,
          text,
          raw: body,
        });
      }
    }
  }
  return messages;
}
