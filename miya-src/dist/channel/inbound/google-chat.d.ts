import type { ChannelInboundMessage } from '../../channels/service';
export interface GoogleChatWebhookBody {
    message?: {
        text?: string;
        sender?: {
            name?: string;
            displayName?: string;
        };
        space?: {
            name?: string;
        };
        thread?: {
            name?: string;
        };
    };
}
export declare function parseGoogleChatInbound(body: GoogleChatWebhookBody): ChannelInboundMessage | null;
