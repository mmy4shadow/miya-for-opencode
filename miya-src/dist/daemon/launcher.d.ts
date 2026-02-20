export interface DaemonConnectionSnapshot {
    connected: boolean;
    statusText: string;
    lifecycleMode?: 'coupled' | 'service_experimental';
    port?: number;
    pid?: number;
    uptimeSec?: number;
    cpuPercent?: number;
    vramUsedMB?: number;
    vramTotalMB?: number;
    lastSeenAt?: string;
    activeJobID?: string;
    activeJobProgress?: number;
    pendingRequests: number;
    rejectedRequests: number;
    lastRejectReason?: string;
    startedAt: string;
}
export interface DaemonLauncherEvent {
    type: 'daemon.ready' | 'daemon.disconnected' | 'job.progress';
    at: string;
    payload?: Record<string, unknown>;
    snapshot: DaemonConnectionSnapshot;
}
type DaemonLauncherListener = (event: DaemonLauncherEvent) => void;
export interface DaemonBackpressureStats {
    connected: boolean;
    maxPendingRequests: number;
    pendingRequests: number;
    rejectedRequests: number;
    lastRejectReason?: string;
}
export declare function ensureMiyaLauncher(projectDir: string): DaemonConnectionSnapshot;
export declare function getLauncherDaemonSnapshot(projectDir: string): DaemonConnectionSnapshot;
export declare function getLauncherBackpressureStats(projectDir: string): DaemonBackpressureStats;
export declare function stopMiyaLauncher(projectDir: string): void;
export declare function subscribeLauncherEvents(projectDir: string, listener: DaemonLauncherListener): () => void;
export declare function daemonInvoke(projectDir: string, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
export {};
