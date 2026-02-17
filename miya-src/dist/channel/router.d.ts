import { assertChannelCanSend, canChannelSend, getChannelDirection } from '../channels/policy';
import type { ChannelConfig, ChannelName } from './types';
export { assertChannelCanSend, canChannelSend, getChannelDirection };
export declare function buildChannelConfig(channel: ChannelName): ChannelConfig;
