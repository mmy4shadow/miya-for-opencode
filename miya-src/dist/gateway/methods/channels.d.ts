import type { ChannelName } from '../../channel';
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
export declare function registerChannelMethods(deps: ChannelMethodDeps): void;
export {};
