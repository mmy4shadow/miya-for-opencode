import type { ChannelName } from './types';
import { ensurePairRequest } from './pairing-store';
export interface ChannelInboundMessage {
    channel: ChannelName;
    senderID: string;
    displayName?: string;
    conversationID: string;
    text: string;
    raw?: unknown;
}
export interface ChannelRuntimeCallbacks {
    onInbound: (message: ChannelInboundMessage) => Promise<void> | void;
    onPairRequested: (pair: ReturnType<typeof ensurePairRequest>) => Promise<void> | void;
}
export declare class ChannelRuntime {
    private readonly projectDir;
    private readonly callbacks;
    private telegramPolling;
    private telegramOffset;
    private slackSocketModeRunning;
    private slackSocket?;
    private slackReconnectTimer?;
    constructor(projectDir: string, callbacks: ChannelRuntimeCallbacks);
    listChannels(): import("./types").ChannelState[];
    listPairs(status?: 'pending' | 'approved' | 'rejected'): import("./types").ChannelPairRequest[];
    approvePair(pairID: string): import("./types").ChannelPairRequest | null;
    rejectPair(pairID: string): import("./types").ChannelPairRequest | null;
    markChannelEnabled(channel: ChannelName, enabled: boolean): void;
    start(): Promise<void>;
    private syncPassiveChannelStates;
    private startSlackSocketMode;
    private scheduleSlackReconnect;
    private handleSlackSocketMessage;
    private startTelegramPolling;
    stop(): void;
    handleInbound(message: ChannelInboundMessage): Promise<void>;
    sendMessage(input: {
        channel: ChannelName;
        destination: string;
        text: string;
    }): Promise<{
        sent: boolean;
        message: string;
    }>;
    private sendPairingMessage;
}
