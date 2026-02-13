import {
  createInvokeRequest,
  createNodePairRequest,
  describeNode,
  issueNodeToken,
  listDevices,
  listInvokeRequests,
  listNodePairs,
  listNodes,
  markInvokeSent,
  markNodeDisconnected,
  registerNode,
  resolveInvokeResult,
  resolveNodePair,
  touchNodeHeartbeat,
} from './store';
import type {
  DeviceRecord,
  NodeInvokeRequest,
  NodePairRequest,
  NodeRecord,
  NodeType,
} from './types';

export class NodeService {
  private readonly projectDir: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  register(input: {
    nodeID: string;
    deviceID: string;
    type?: NodeType;
    platform: string;
    capabilities: string[];
    permissions?: Partial<NodeRecord['permissions']>;
    token?: string;
  }): NodeRecord {
    return registerNode(this.projectDir, input);
  }

  touchHeartbeat(nodeID: string): NodeRecord | null {
    return touchNodeHeartbeat(this.projectDir, nodeID);
  }

  disconnect(nodeID: string): void {
    markNodeDisconnected(this.projectDir, nodeID);
  }

  list(): NodeRecord[] {
    return listNodes(this.projectDir);
  }

  listDevices(): DeviceRecord[] {
    return listDevices(this.projectDir);
  }

  describe(nodeID: string): NodeRecord | null {
    return describeNode(this.projectDir, nodeID);
  }

  issueToken(nodeID: string): { nodeID: string; token: string; issuedAt: string } | null {
    return issueNodeToken(this.projectDir, nodeID);
  }

  createPairRequest(input: { nodeID: string; deviceID: string }): NodePairRequest {
    return createNodePairRequest(this.projectDir, input);
  }

  listPairRequests(status?: 'pending' | 'approved' | 'rejected'): NodePairRequest[] {
    return listNodePairs(this.projectDir, status);
  }

  resolvePairRequest(
    pairID: string,
    status: 'approved' | 'rejected',
  ): NodePairRequest | null {
    return resolveNodePair(this.projectDir, pairID, status);
  }

  createInvoke(input: {
    nodeID: string;
    capability: string;
    args: Record<string, unknown>;
  }): NodeInvokeRequest {
    return createInvokeRequest(this.projectDir, input);
  }

  markInvokeSent(invokeID: string): NodeInvokeRequest | null {
    return markInvokeSent(this.projectDir, invokeID);
  }

  resolveInvoke(
    invokeID: string,
    input: {
      ok: boolean;
      result?: Record<string, unknown>;
      error?: string;
    },
  ): NodeInvokeRequest | null {
    return resolveInvokeResult(this.projectDir, invokeID, input);
  }

  listInvokes(limit = 50): NodeInvokeRequest[] {
    return listInvokeRequests(this.projectDir, limit);
  }
}
