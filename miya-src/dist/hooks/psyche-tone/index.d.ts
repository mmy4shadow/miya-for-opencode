import { type MessageWithParts } from '../neural-chain/shared';
interface PsycheToneConfig {
    enabled?: boolean;
}
export declare function createPsycheToneHook(rawConfig?: PsycheToneConfig): {
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export {};
