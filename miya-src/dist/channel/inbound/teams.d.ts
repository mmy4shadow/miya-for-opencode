import type { ChannelInboundMessage } from '../../channels/service';
export interface TeamsWebhookBody {
    type?: string;
    text?: string;
    from?: {
        id?: string;
        name?: string;
    };
    conversation?: {
        id?: string;
    };
}
export declare function parseTeamsInbound(body: TeamsWebhookBody): ChannelInboundMessage | null;
