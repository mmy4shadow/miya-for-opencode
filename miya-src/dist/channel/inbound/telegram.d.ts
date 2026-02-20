import type { ChannelInboundMessage } from '../../channels/service';
export interface TelegramWebhookBody {
    message?: {
        chat?: {
            id?: string | number;
        };
        from?: {
            id?: string | number;
            username?: string;
            first_name?: string;
        };
        text?: string;
    };
}
export declare function parseTelegramInbound(body: TelegramWebhookBody): ChannelInboundMessage | null;
