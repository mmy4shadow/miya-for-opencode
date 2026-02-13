export type { ChannelName, ChannelPairRequest, ChannelState, ChannelStore } from '../channels/types';
export { CHANNEL_NAMES, isChannelName } from '../channels/types';
export type { ChannelDirection } from '../channels/policy';
import type { ChannelName } from '../channels/types';
import type { ChannelDirection } from '../channels/policy';

export interface ChannelConfig {
  id: string;
  type: ChannelName;
  direction: ChannelDirection;
  allowSend: boolean;
  allowReceive: boolean;
}

export interface UnifiedMessage {
  id: string;
  channel: ChannelConfig;
  direction: 'inbound' | 'outbound';
  sender: { id: string; name: string };
  content: { type: 'text' | 'image' | 'file'; data: unknown };
  timestamp: string;
  outboundCheck?: {
    archAdvisorApproved: boolean;
    targetInAllowlist: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    auditId: string;
  };
}
