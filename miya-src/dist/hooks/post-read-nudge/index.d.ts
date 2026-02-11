/**
 * Post-Read nudge - appends a delegation reminder after file reads.
 * Catches the "read files → implement myself" anti-pattern.
 */
interface ToolExecuteAfterInput {
    tool: string;
    sessionID?: string;
    callID?: string;
}
interface ToolExecuteAfterOutput {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
}
export declare function createPostReadNudgeHook(): {
    'tool.execute.after': (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>;
};
export {};
