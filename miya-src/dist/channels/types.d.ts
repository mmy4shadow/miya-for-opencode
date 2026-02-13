export declare const CHANNEL_NAMES: readonly ["telegram", "slack", "discord", "whatsapp", "google_chat", "signal", "imessage", "teams", "webchat"];
export type ChannelName = (typeof CHANNEL_NAMES)[number];
export declare function isChannelName(value: unknown): value is ChannelName;
export interface ChannelPairRequest {
    id: string;
    channel: ChannelName;
    senderID: string;
    displayName?: string;
    messagePreview?: string;
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: string;
    resolvedAt?: string;
}
export interface ChannelState {
    name: ChannelName;
    enabled: boolean;
    connected: boolean;
    lastError?: string;
    updatedAt: string;
    allowlist: string[];
}
export interface ChannelStore {
    channels: Record<ChannelName, ChannelState>;
    pairs: ChannelPairRequest[];
}
