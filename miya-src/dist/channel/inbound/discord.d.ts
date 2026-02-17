import type { ChannelInboundMessage } from '../../channels/service';
export interface DiscordWebhookBody {
    content?: string;
    channel_id?: string;
    author?: {
        id?: string;
        username?: string;
        bot?: boolean;
    };
}
export declare function parseDiscordInbound(body: DiscordWebhookBody): ChannelInboundMessage | null;
