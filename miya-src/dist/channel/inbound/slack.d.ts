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
export declare function parseSlackInbound(body: SlackWebhookBody): ChannelInboundMessage | null;
