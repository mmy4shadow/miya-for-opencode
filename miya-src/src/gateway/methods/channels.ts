import type { ChannelName } from '../../channel';
import {
  getContactTier,
  listContactTiers,
  setContactTier,
} from '../../channel';
import { getMediaItem } from '../../media/store';
import type { GatewayMethodRegistrarDeps } from './types';

interface GuardedOutboundCheckInput {
  archAdvisorApproved?: boolean;
  intent?: string;
  factorRecipientIsMe?: boolean;
  userInitiated?: boolean;
  negotiationID?: string;
  retryAttemptType?: 'auto' | 'human';
  evidenceConfidence?: number;
  captureLimitations?: string[];
  psycheSignals?: Record<string, unknown>;
}

export interface ChannelMethodDeps extends GatewayMethodRegistrarDeps {
  runtime: {
    channelRuntime: {
      listChannels: () => unknown;
      listPairs: (status?: 'pending' | 'approved' | 'rejected') => unknown;
      approvePair: (pairID: string) => unknown;
      rejectPair: (pairID: string) => unknown;
    };
  };
  parseChannel: (value: unknown) => ChannelName | null;
  sendChannelMessageGuarded: (input: {
    channel: ChannelName;
    destination: string;
    text: string;
    mediaPath: string;
    idempotencyKey?: string;
    sessionID: string;
    policyHash?: string;
    outboundCheck: GuardedOutboundCheckInput;
    confirmation: {
      physicalConfirmed?: boolean;
      password?: string;
      passphrase?: string;
      ownerSyncToken?: string;
    };
  }) => Promise<unknown>;
}

export function registerChannelMethods(deps: ChannelMethodDeps): void {
  const { methods, projectDir, parseText, parseChannel } = deps;

  methods.register('channels.list', async () =>
    deps.runtime.channelRuntime.listChannels(),
  );
  methods.register('channels.status', async () => ({
    channels: deps.runtime.channelRuntime.listChannels(),
    pendingPairs: deps.runtime.channelRuntime.listPairs('pending'),
  }));
  methods.register('channels.pair.list', async (params) => {
    if (
      params.status === 'pending' ||
      params.status === 'approved' ||
      params.status === 'rejected'
    ) {
      return deps.runtime.channelRuntime.listPairs(params.status);
    }
    return deps.runtime.channelRuntime.listPairs();
  });
  methods.register('channels.pair.approve', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return deps.runtime.channelRuntime.approvePair(pairID);
  });
  methods.register('channels.pair.reject', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return deps.runtime.channelRuntime.rejectPair(pairID);
  });
  methods.register('channels.contact.tier.set', async (params) => {
    const channel = parseChannel(params.channel);
    const senderID = parseText(params.senderID);
    const tier = parseText(params.tier);
    if (!channel || !senderID)
      throw new Error('invalid_channels_contact_tier_args');
    if (tier !== 'owner' && tier !== 'friend') {
      throw new Error('invalid_channels_contact_tier');
    }
    return setContactTier(projectDir, channel, senderID, tier);
  });
  methods.register('channels.contact.tier.get', async (params) => {
    const channel = parseChannel(params.channel);
    const senderID = parseText(params.senderID);
    if (!channel || !senderID)
      throw new Error('invalid_channels_contact_tier_args');
    return {
      channel,
      senderID,
      tier: getContactTier(projectDir, channel, senderID),
    };
  });
  methods.register('channels.contact.tier.list', async (params) => {
    const channel = parseChannel(params.channel);
    return {
      contacts: listContactTiers(projectDir, channel ?? undefined),
    };
  });
  methods.register('channels.message.send', async (params) => {
    const channel = parseChannel(params.channel);
    const destination = parseText(params.destination);
    const text = parseText(params.text);
    const mediaID = parseText(params.mediaID);
    const mediaPathInput = parseText(params.mediaPath);
    const idempotencyKey = parseText(params.idempotencyKey);
    const sessionID = parseText(params.sessionID) || 'main';
    const policyHash = parseText(params.policyHash) || undefined;
    const mediaFromStore = mediaID ? getMediaItem(projectDir, mediaID) : null;
    const mediaPath = mediaPathInput || mediaFromStore?.localPath || '';
    if (!channel || !destination || (!text && !mediaPath)) {
      throw new Error('invalid_channels_send_args');
    }
    const outboundCheckRaw =
      params.outboundCheck && typeof params.outboundCheck === 'object'
        ? (params.outboundCheck as Record<string, unknown>)
        : null;
    const outboundCheck: GuardedOutboundCheckInput = {
      archAdvisorApproved:
        outboundCheckRaw &&
        typeof outboundCheckRaw.archAdvisorApproved === 'boolean'
          ? Boolean(outboundCheckRaw.archAdvisorApproved)
          : undefined,
      intent:
        outboundCheckRaw && typeof outboundCheckRaw.intent === 'string'
          ? String(outboundCheckRaw.intent)
          : undefined,
      factorRecipientIsMe:
        outboundCheckRaw &&
        typeof outboundCheckRaw.factorRecipientIsMe === 'boolean'
          ? Boolean(outboundCheckRaw.factorRecipientIsMe)
          : undefined,
      userInitiated:
        outboundCheckRaw && typeof outboundCheckRaw.userInitiated === 'boolean'
          ? Boolean(outboundCheckRaw.userInitiated)
          : undefined,
      negotiationID:
        outboundCheckRaw && typeof outboundCheckRaw.negotiationID === 'string'
          ? String(outboundCheckRaw.negotiationID)
          : undefined,
      retryAttemptType:
        outboundCheckRaw &&
        (outboundCheckRaw.retryAttemptType === 'auto' ||
          outboundCheckRaw.retryAttemptType === 'human')
          ? (outboundCheckRaw.retryAttemptType as 'auto' | 'human')
          : undefined,
      evidenceConfidence:
        outboundCheckRaw &&
        typeof outboundCheckRaw.evidenceConfidence === 'number' &&
        Number.isFinite(outboundCheckRaw.evidenceConfidence)
          ? Number(outboundCheckRaw.evidenceConfidence)
          : undefined,
      captureLimitations:
        outboundCheckRaw && Array.isArray(outboundCheckRaw.captureLimitations)
          ? outboundCheckRaw.captureLimitations
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter((item) => item.length > 0)
              .slice(0, 32)
          : undefined,
      psycheSignals:
        outboundCheckRaw?.psycheSignals &&
        typeof outboundCheckRaw.psycheSignals === 'object' &&
        !Array.isArray(outboundCheckRaw.psycheSignals)
          ? (outboundCheckRaw.psycheSignals as GuardedOutboundCheckInput['psycheSignals'])
          : undefined,
    };
    const confirmationRaw =
      params.confirmation && typeof params.confirmation === 'object'
        ? (params.confirmation as Record<string, unknown>)
        : null;

    return deps.sendChannelMessageGuarded({
      channel,
      destination,
      text,
      mediaPath,
      idempotencyKey,
      sessionID,
      policyHash,
      outboundCheck,
      confirmation: {
        physicalConfirmed:
          confirmationRaw &&
          typeof confirmationRaw.physicalConfirmed === 'boolean'
            ? Boolean(confirmationRaw.physicalConfirmed)
            : undefined,
        password:
          confirmationRaw && typeof confirmationRaw.password === 'string'
            ? String(confirmationRaw.password)
            : undefined,
        passphrase:
          confirmationRaw && typeof confirmationRaw.passphrase === 'string'
            ? String(confirmationRaw.passphrase)
            : undefined,
        ownerSyncToken:
          confirmationRaw && typeof confirmationRaw.ownerSyncToken === 'string'
            ? String(confirmationRaw.ownerSyncToken)
            : undefined,
      },
    });
  });
}
