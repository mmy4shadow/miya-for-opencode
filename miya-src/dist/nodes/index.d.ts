export type NodeType = 'cli' | 'desktop' | 'mobile' | 'browser';
export type NodeStatus = 'online' | 'offline' | 'error';
export interface NodePermissions {
    screenRecording: boolean;
    accessibility: boolean;
    filesystem: 'none' | 'read' | 'full';
    network: boolean;
}
export interface NodeRecord {
    nodeID: string;
    deviceID: string;
    type: NodeType;
    role: 'node';
    platform: string;
    permissions: NodePermissions;
    capabilities: string[];
    connected: boolean;
    paired: boolean;
    status: NodeStatus;
    tokenHash?: string;
    tokenIssuedAt?: string;
    tokenLastUsedAt?: string;
    lastHeartbeatAt: string;
    lastSeenAt: string;
    createdAt: string;
    updatedAt: string;
}
export interface DeviceRecord {
    deviceID: string;
    label?: string;
    approved: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface NodePairRequest {
    id: string;
    nodeID: string;
    deviceID: string;
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: string;
    resolvedAt?: string;
}
export interface NodeInvokeRequest {
    id: string;
    nodeID: string;
    capability: string;
    args: Record<string, unknown>;
    status: 'pending' | 'sent' | 'completed' | 'failed';
    createdAt: string;
    updatedAt: string;
    result?: Record<string, unknown>;
    error?: string;
}
export declare function registerNode(projectDir: string, input: {
    nodeID: string;
    deviceID: string;
    type?: NodeType;
    platform: string;
    capabilities: string[];
    permissions?: Partial<NodePermissions>;
    token?: string;
}): NodeRecord;
export declare function touchNodeHeartbeat(projectDir: string, nodeID: string): NodeRecord | null;
export declare function markNodeDisconnected(projectDir: string, nodeID: string): void;
export declare function listNodes(projectDir: string): NodeRecord[];
export declare function listDevices(projectDir: string): DeviceRecord[];
export declare function describeNode(projectDir: string, nodeID: string): NodeRecord | null;
export declare function issueNodeToken(projectDir: string, nodeID: string): {
    nodeID: string;
    token: string;
    issuedAt: string;
} | null;
export declare function createNodePairRequest(projectDir: string, input: {
    nodeID: string;
    deviceID: string;
}): NodePairRequest;
export declare function listNodePairs(projectDir: string, status?: 'pending' | 'approved' | 'rejected'): NodePairRequest[];
export declare function resolveNodePair(projectDir: string, pairID: string, status: 'approved' | 'rejected'): NodePairRequest | null;
export declare function createInvokeRequest(projectDir: string, input: {
    nodeID: string;
    capability: string;
    args: Record<string, unknown>;
}): NodeInvokeRequest;
export declare function markInvokeSent(projectDir: string, invokeID: string): NodeInvokeRequest | null;
export declare function resolveInvokeResult(projectDir: string, invokeID: string, input: {
    ok: boolean;
    result?: Record<string, unknown>;
    error?: string;
}): NodeInvokeRequest | null;
export declare function listInvokeRequests(projectDir: string, limit?: number): NodeInvokeRequest[];
