import type { ChannelName } from './types';

export type ChannelDirection = 'INBOUND_ONLY' | 'OUTBOUND_ALLOWLIST';

const OUTBOUND_ALLOWLIST_CHANNELS = new Set<ChannelName>(['qq', 'wechat']);

export function getChannelDirection(channel: ChannelName): ChannelDirection {
  return OUTBOUND_ALLOWLIST_CHANNELS.has(channel)
    ? 'OUTBOUND_ALLOWLIST'
    : 'INBOUND_ONLY';
}

export function canChannelSend(channel: ChannelName): boolean {
  return getChannelDirection(channel) === 'OUTBOUND_ALLOWLIST';
}

export function assertChannelCanSend(channel: ChannelName): void {
  if (canChannelSend(channel)) return;
  throw new Error(
    `channel_send_blocked:${channel}:INBOUND_ONLY channels are receive-only`,
  );
}
