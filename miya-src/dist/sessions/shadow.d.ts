export declare function shouldRouteToShadowSession(input: {
    tool?: string;
    output?: string;
}): boolean;
export declare function appendShadowSessionLog(input: {
    projectDir: string;
    sessionID?: string;
    tool: string;
    callID?: string;
    output: string;
}): string;
