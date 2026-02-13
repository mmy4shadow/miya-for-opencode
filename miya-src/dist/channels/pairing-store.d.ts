import { type ChannelName, type ChannelPairRequest, type ChannelState, type ChannelStore } from './types';
export declare function readChannelStore(projectDir: string): ChannelStore;
export declare function writeChannelStore(projectDir: string, store: ChannelStore): void;
export declare function listChannelStates(projectDir: string): ChannelState[];
export declare function upsertChannelState(projectDir: string, name: ChannelName, patch: Partial<Omit<ChannelState, 'name'>>): ChannelState;
export declare function ensurePairRequest(projectDir: string, input: {
    channel: ChannelName;
    senderID: string;
    displayName?: string;
    messagePreview?: string;
}): ChannelPairRequest;
export declare function resolvePairRequest(projectDir: string, pairID: string, status: 'approved' | 'rejected'): ChannelPairRequest | null;
export declare function listPairRequests(projectDir: string, status?: 'pending' | 'approved' | 'rejected'): ChannelPairRequest[];
export declare function isSenderAllowed(projectDir: string, channel: ChannelName, senderID: string): boolean;
