interface MessageInfo {
    role: string;
    agent?: string;
}
interface MessagePart {
    type: string;
    text?: string;
}
interface MessageWithParts {
    info: MessageInfo;
    parts: MessagePart[];
}
export declare function createSlashCommandBridgeHook(): {
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export {};
