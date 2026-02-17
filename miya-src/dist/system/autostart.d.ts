export interface AutostartState {
    enabled: boolean;
    taskName: string;
    command: string;
    updatedAt: string;
}
export interface AutostartStatus {
    platform: NodeJS.Platform;
    supported: boolean;
    enabled: boolean;
    installed: boolean;
    taskName: string;
    command: string;
    updatedAt?: string;
    reason?: string;
}
export declare function getAutostartStatus(projectDir: string): AutostartStatus;
export declare function setAutostartEnabled(projectDir: string, input: {
    enabled: boolean;
    taskName?: string;
    command?: string;
}): AutostartStatus;
