import type { DeviceRecord, NodeInvokeRequest, NodePairRequest, NodeRecord, NodeType } from './types';
export declare class NodeService {
    private readonly projectDir;
    constructor(projectDir: string);
    register(input: {
        nodeID: string;
        deviceID: string;
        type?: NodeType;
        platform: string;
        capabilities: string[];
        permissions?: Partial<NodeRecord['permissions']>;
        token?: string;
    }): NodeRecord;
    touchHeartbeat(nodeID: string): NodeRecord | null;
    disconnect(nodeID: string): void;
    list(): NodeRecord[];
    listDevices(): DeviceRecord[];
    describe(nodeID: string): NodeRecord | null;
    issueToken(nodeID: string): {
        nodeID: string;
        token: string;
        issuedAt: string;
    } | null;
    createPairRequest(input: {
        nodeID: string;
        deviceID: string;
    }): NodePairRequest;
    listPairRequests(status?: 'pending' | 'approved' | 'rejected'): NodePairRequest[];
    resolvePairRequest(pairID: string, status: 'approved' | 'rejected'): NodePairRequest | null;
    createInvoke(input: {
        nodeID: string;
        capability: string;
        args: Record<string, unknown>;
    }): NodeInvokeRequest;
    markInvokeSent(invokeID: string): NodeInvokeRequest | null;
    resolveInvoke(invokeID: string, input: {
        ok: boolean;
        result?: Record<string, unknown>;
        error?: string;
    }): NodeInvokeRequest | null;
    listInvokes(limit?: number): NodeInvokeRequest[];
}
