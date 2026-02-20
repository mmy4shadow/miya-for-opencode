export interface CommandResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}
export declare function runCommand(command: string, args: string[], timeoutMs?: number): Promise<CommandResult>;
