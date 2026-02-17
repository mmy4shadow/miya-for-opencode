export interface WindowsShellResult<T> {
    ok: boolean;
    value?: T;
    error?: string;
}
export declare function runWindowsPowerShellJson<T>(script: string, timeoutMs: number): WindowsShellResult<T>;
