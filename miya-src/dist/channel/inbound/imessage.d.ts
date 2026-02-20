import type { ChannelInboundMessage } from '../../channels/service';
export interface IMessageWebhookBody {
    data?: {
        text?: string;
        chatGuid?: string;
        handle?: {
            address?: string;
        };
        isFromMe?: boolean;
        displayName?: string;
    };
}
export declare function parseIMessageInbound(body: IMessageWebhookBody): ChannelInboundMessage | null;
