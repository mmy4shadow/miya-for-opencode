import { type MessageWithParts } from '../neural-chain/shared';
interface ModeKernelHookConfig {
    enabled?: boolean;
    minConfidenceForSafeMode?: number;
}
export declare function createModeKernelHook(rawConfig?: ModeKernelHookConfig): {
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export {};
