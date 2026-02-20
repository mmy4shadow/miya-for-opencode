interface ContextGovernorConfig {
    enabled?: boolean;
    toolOutputMaxChars?: number;
    toolOutputHeadChars?: number;
    toolOutputTailChars?: number;
    recordTtlMs?: number;
    maxRecordsPerSession?: number;
    maxInjectedRecords?: number;
    maxInjectedChars?: number;
}
interface ToolExecuteAfterInput {
    tool: string;
    sessionID?: string;
}
interface ToolExecuteAfterOutput {
    output: string;
}
interface MessageInfo {
    role: string;
    agent?: string;
    sessionID?: string;
}
interface MessagePart {
    type: string;
    text?: string;
}
interface MessageWithParts {
    info: MessageInfo;
    parts: MessagePart[];
}
interface CreateHookOptions {
    now?: () => number;
}
export declare function createContextGovernorHook(rawConfig?: ContextGovernorConfig, options?: CreateHookOptions): {
    'tool.execute.after': (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>;
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export {};
