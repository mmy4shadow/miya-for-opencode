import {
  assertChannelCanSend,
  canChannelSend,
  getChannelDirection,
} from '../channels/policy';
import type { ChannelConfig, ChannelName } from './types';

export { assertChannelCanSend, canChannelSend, getChannelDirection };

export function buildChannelConfig(channel: ChannelName): ChannelConfig {
  const direction = getChannelDirection(channel);
  return {
    id: channel,
    type: channel,
    direction,
    allowSend: direction === 'OUTBOUND_ALLOWLIST',
    allowReceive: direction === 'INBOUND_ONLY',
  };
}
