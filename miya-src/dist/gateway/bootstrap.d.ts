interface GatewayStateShape {
    url: string;
    port: number;
    pid: number;
    startedAt: string;
    status: string;
}
export declare function formatGatewayStateWithRuntime(state: GatewayStateShape, ownerPID?: number, isOwner?: boolean, activeAgentId?: string, storageRevision?: number): string;
export declare function formatGatewayState(state: GatewayStateShape): string;
export {};
