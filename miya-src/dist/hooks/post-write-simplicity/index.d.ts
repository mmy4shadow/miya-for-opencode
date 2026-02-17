/**
 * Post-Write simplicity nudge - appends a compact review reminder after write/edit tools.
 * Disabled unless slimCompat.enablePostWriteSimplicityNudge is enabled.
 */
interface ToolExecuteAfterInput {
    tool: string;
}
interface ToolExecuteAfterOutput {
    output: string;
}
export declare function createPostWriteSimplicityHook(): {
    'tool.execute.after': (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>;
};
export {};
