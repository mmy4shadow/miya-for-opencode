import type WebSocket from 'ws';
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
  registerNode,
  resolveInvokeResult,
  resolveNodePair,
  touchNodeHeartbeat,
} from '../../nodes';
import { type GatewayMethodContext, toEventFrame } from '../protocol';
import type { GatewayMethodRegistrarDeps } from './types';

export interface NodeMethodDeps extends GatewayMethodRegistrarDeps {
  runtime: {
    nodeSockets: Map<string, WebSocket>;
    stateVersion: number;
  };
  requirePolicyHash: (
    projectDir: string,
    providedHash: string | undefined,
  ) => string;
  requireDomainRunning: (projectDir: string, domain: 'desktop_control') => void;
  enforceToken: (input: {
    projectDir: string;
    sessionID: string;
    permission: string;
    patterns: string[];
  }) => { ok: true } | { ok: false; reason: string };
  hashText: (input: string) => string;
}

export function registerNodeMethods(deps: NodeMethodDeps): void {
  const { methods, projectDir, parseText } = deps;

  methods.register('nodes.register', async (params, context) => {
    const nodeID = parseText(params.nodeID);
    const deviceID = parseText(params.deviceID);
    if (!nodeID || !deviceID) throw new Error('invalid_nodes_register_args');
    const node = registerNode(projectDir, {
      nodeID,
      deviceID,
      type:
        params.type === 'cli' ||
        params.type === 'desktop' ||
        params.type === 'mobile' ||
        params.type === 'browser'
          ? params.type
          : undefined,
      platform: parseText(params.platform) || process.platform,
      capabilities: Array.isArray(params.capabilities)
        ? params.capabilities.map(String)
        : [],
      token: parseText(params.token) || undefined,
      permissions:
        params.permissions && typeof params.permissions === 'object'
          ? {
              screenRecording:
                typeof (params.permissions as Record<string, unknown>)
                  .screenRecording === 'boolean'
                  ? Boolean(
                      (params.permissions as Record<string, unknown>)
                        .screenRecording,
                    )
                  : undefined,
              accessibility:
                typeof (params.permissions as Record<string, unknown>)
                  .accessibility === 'boolean'
                  ? Boolean(
                      (params.permissions as Record<string, unknown>)
                        .accessibility,
                    )
                  : undefined,
              filesystem:
                (params.permissions as Record<string, unknown>).filesystem ===
                  'none' ||
                (params.permissions as Record<string, unknown>).filesystem ===
                  'read' ||
                (params.permissions as Record<string, unknown>).filesystem ===
                  'full'
                  ? ((params.permissions as Record<string, unknown>)
                      .filesystem as 'none' | 'read' | 'full')
                  : undefined,
              network:
                typeof (params.permissions as Record<string, unknown>)
                  .network === 'boolean'
                  ? Boolean(
                      (params.permissions as Record<string, unknown>).network,
                    )
                  : undefined,
            }
          : undefined,
    });
    const pair = createNodePairRequest(projectDir, { nodeID, deviceID });
    const ws = (context as GatewayMethodContext & { ws?: WebSocket }).ws;
    if (ws) deps.runtime.nodeSockets.set(nodeID, ws);
    return { node, pair };
  });

  methods.register('nodes.list', async () => listNodes(projectDir));
  methods.register('nodes.heartbeat', async (params) => {
    const nodeID = parseText(params.nodeID);
    if (!nodeID) throw new Error('invalid_node_id');
    const node = touchNodeHeartbeat(projectDir, nodeID);
    if (!node) throw new Error('node_not_found');
    return node;
  });
  methods.register('nodes.token.issue', async (params) => {
    const nodeID = parseText(params.nodeID);
    if (!nodeID) throw new Error('invalid_node_id');
    const issued = issueNodeToken(projectDir, nodeID);
    if (!issued) throw new Error('node_not_found');
    return issued;
  });
  methods.register('nodes.status', async () => ({
    nodes: listNodes(projectDir),
    pendingPairs: listNodePairs(projectDir, 'pending'),
  }));
  methods.register('nodes.describe', async (params) => {
    const nodeID = parseText(params.nodeID);
    if (!nodeID) throw new Error('invalid_node_id');
    return describeNode(projectDir, nodeID);
  });
  methods.register('nodes.pair.list', async (params) => {
    if (
      params.status === 'pending' ||
      params.status === 'approved' ||
      params.status === 'rejected'
    ) {
      return listNodePairs(projectDir, params.status);
    }
    return listNodePairs(projectDir);
  });
  methods.register('nodes.pair.approve', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return resolveNodePair(projectDir, pairID, 'approved');
  });
  methods.register('nodes.pair.reject', async (params) => {
    const pairID = parseText(params.pairID);
    if (!pairID) throw new Error('invalid_pair_id');
    return resolveNodePair(projectDir, pairID, 'rejected');
  });
  methods.register('nodes.invoke', async (params) => {
    const nodeID = parseText(params.nodeID);
    const capability = parseText(params.capability);
    const sessionID = parseText(params.sessionID) || 'main';
    const policyHash = parseText(params.policyHash) || undefined;
    const args =
      params.args && typeof params.args === 'object'
        ? (params.args as Record<string, unknown>)
        : {};
    if (!nodeID || !capability) throw new Error('invalid_nodes_invoke_args');
    deps.requirePolicyHash(projectDir, policyHash);
    deps.requireDomainRunning(projectDir, 'desktop_control');

    const token = deps.enforceToken({
      projectDir,
      sessionID,
      permission: 'node_invoke',
      patterns: [
        `nodeId=${nodeID}`,
        `cap=${capability}`,
        `args_sha256=${deps.hashText(JSON.stringify(args))}`,
      ],
    });
    if (!token.ok) throw new Error(`approval_required:${token.reason}`);

    const invoke = createInvokeRequest(projectDir, {
      nodeID,
      capability,
      args,
    });
    markInvokeSent(projectDir, invoke.id);

    const nodeSocket = deps.runtime.nodeSockets.get(nodeID);
    if (nodeSocket) {
      nodeSocket.send(
        JSON.stringify(
          toEventFrame({
            event: 'node.invoke.request',
            payload: invoke,
            stateVersion: { gateway: deps.runtime.stateVersion },
          }),
        ),
      );
    }

    return invoke;
  });

  methods.register('nodes.invoke.result', async (params) => {
    const invokeID = parseText(params.invokeID);
    if (!invokeID) throw new Error('invalid_invoke_id');
    return resolveInvokeResult(projectDir, invokeID, {
      ok: Boolean(params.ok),
      result:
        params.result && typeof params.result === 'object'
          ? (params.result as Record<string, unknown>)
          : undefined,
      error: parseText(params.error) || undefined,
    });
  });

  methods.register('devices.list', async () => listDevices(projectDir));
  methods.register('nodes.invokes.list', async (params) => {
    const limit =
      typeof params.limit === 'number' && params.limit > 0
        ? Math.min(200, Math.floor(params.limit))
        : 40;
    return listInvokeRequests(projectDir, limit);
  });
}
