import type { ChannelInboundMessage } from '../../channels/service';
export interface SignalWebhookBody {
    envelope?: {
        source?: string;
        sourceName?: string;
        dataMessage?: {
            message?: string;
        };
    };
}
export declare function parseSignalInbound(body: SignalWebhookBody): ChannelInboundMessage | null;
