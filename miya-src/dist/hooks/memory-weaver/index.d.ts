import { type MessageWithParts } from '../neural-chain/shared';
interface MemoryWeaverConfig {
    enabled?: boolean;
}
export declare function createMemoryWeaverHook(projectDir: string, rawConfig?: MemoryWeaverConfig): {
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export {};
