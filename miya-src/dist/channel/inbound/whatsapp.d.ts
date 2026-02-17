import type { ChannelInboundMessage } from '../../channels/service';
export interface WhatsAppWebhookBody {
    entry?: Array<{
        changes?: Array<{
            value?: {
                contacts?: Array<{
                    wa_id?: string;
                    profile?: {
                        name?: string;
                    };
                }>;
                messages?: Array<{
                    from?: string;
                    text?: {
                        body?: string;
                    };
                }>;
            };
        }>;
    }>;
}
export declare function parseWhatsappInbound(body: WhatsAppWebhookBody): ChannelInboundMessage[];
