import type { ChannelName } from './types';
export type ChannelDirection = 'INBOUND_ONLY' | 'OUTBOUND_ALLOWLIST';
export declare function getChannelDirection(channel: ChannelName): ChannelDirection;
export declare function canChannelSend(channel: ChannelName): boolean;
export declare function assertChannelCanSend(channel: ChannelName): void;
