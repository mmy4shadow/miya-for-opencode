export type ChannelName = 'telegram' | 'slack' | 'webchat';

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
