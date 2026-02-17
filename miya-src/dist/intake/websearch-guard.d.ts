export interface PermissionAskForIntakeGate {
    sessionID: string;
    permission: string;
}
export declare function trackWebsearchToolOutput(sessionID: string | undefined, tool: string, outputText: string): void;
export declare function shouldInterceptWriteAfterWebsearch(projectDir: string, input: PermissionAskForIntakeGate): {
    intercept: boolean;
    reason: string;
    proposalID?: string;
};
