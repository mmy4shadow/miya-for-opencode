export const CHANNEL_NAMES = [
  'qq',
  'wechat',
  'telegram',
  'slack',
  'discord',
  'whatsapp',
  'google_chat',
  'signal',
  'imessage',
  'teams',
  'webchat',
] as const;

export type ChannelName = (typeof CHANNEL_NAMES)[number];

export function isChannelName(value: unknown): value is ChannelName {
  return (
    typeof value === 'string' &&
    (CHANNEL_NAMES as readonly string[]).includes(value)
  );
}

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
