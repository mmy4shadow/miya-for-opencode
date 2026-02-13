import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getMiyaRuntimeDir } from '../workflow';

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

interface NodeStore {
  nodes: Record<string, NodeRecord>;
  devices: Record<string, DeviceRecord>;
  pairs: NodePairRequest[];
  invokes: Record<string, NodeInvokeRequest>;
}

const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function defaultNodePermissions(): NodePermissions {
  return {
    screenRecording: false,
    accessibility: false,
    filesystem: 'none',
    network: false,
  };
}

function inferPermissionsFromCapabilities(
  capabilities: string[],
  base?: Partial<NodePermissions>,
): NodePermissions {
  const inferred = defaultNodePermissions();
  for (const capability of capabilities) {
    if (capability === 'perm.screenRecording') inferred.screenRecording = true;
    if (capability === 'perm.accessibility') inferred.accessibility = true;
    if (capability === 'perm.network') inferred.network = true;
    if (capability.startsWith('perm.filesystem.')) {
      const suffix = capability.slice('perm.filesystem.'.length);
      if (suffix === 'none' || suffix === 'read' || suffix === 'full') {
        inferred.filesystem = suffix;
      }
    }
  }
  return {
    ...inferred,
    ...(base ?? {}),
  };
}

function normalizeNodeRecord(partial: Partial<NodeRecord>): NodeRecord {
  const capabilityList = Array.isArray(partial.capabilities)
    ? partial.capabilities
        .map((item) => String(item))
        .filter(Boolean)
        .sort()
    : [];
  const fallbackHeartbeat = String(partial.lastSeenAt ?? nowIso());
  const permissions = inferPermissionsFromCapabilities(capabilityList, partial.permissions);
  const status: NodeStatus = partial.connected ? 'online' : 'offline';
  return {
    nodeID: String(partial.nodeID ?? ''),
    deviceID: String(partial.deviceID ?? ''),
    type:
      partial.type === 'cli' ||
      partial.type === 'desktop' ||
      partial.type === 'mobile' ||
      partial.type === 'browser'
        ? partial.type
        : 'cli',
    role: 'node',
    platform: String(partial.platform ?? process.platform),
    permissions,
    capabilities: capabilityList,
    connected: Boolean(partial.connected),
    paired: Boolean(partial.paired),
    status:
      partial.status === 'online' ||
      partial.status === 'offline' ||
      partial.status === 'error'
        ? partial.status
        : status,
    tokenHash: typeof partial.tokenHash === 'string' ? partial.tokenHash : undefined,
    tokenIssuedAt:
      typeof partial.tokenIssuedAt === 'string' ? partial.tokenIssuedAt : undefined,
    tokenLastUsedAt:
      typeof partial.tokenLastUsedAt === 'string'
        ? partial.tokenLastUsedAt
        : undefined,
    lastHeartbeatAt:
      typeof partial.lastHeartbeatAt === 'string'
        ? partial.lastHeartbeatAt
        : fallbackHeartbeat,
    lastSeenAt: String(partial.lastSeenAt ?? fallbackHeartbeat),
    createdAt: String(partial.createdAt ?? nowIso()),
    updatedAt: String(partial.updatedAt ?? nowIso()),
  };
}

function applyHeartbeatHealth(store: NodeStore): boolean {
  const now = Date.now();
  let changed = false;
  for (const node of Object.values(store.nodes)) {
    const heartbeatAt = Date.parse(node.lastHeartbeatAt || node.lastSeenAt);
    if (Number.isNaN(heartbeatAt)) continue;
    const stale = now - heartbeatAt > HEARTBEAT_STALE_MS;
    if (stale && (node.connected || node.status === 'online')) {
      node.connected = false;
      node.status = 'offline';
      node.updatedAt = nowIso();
      changed = true;
    }
  }
  return changed;
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'nodes.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readStore(projectDir: string): NodeStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return {
      nodes: {},
      devices: {},
      pairs: [],
      invokes: {},
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<NodeStore>;
    const rawNodes = parsed.nodes ?? {};
    const nodes: Record<string, NodeRecord> = {};
    for (const [nodeID, node] of Object.entries(rawNodes)) {
      const normalized = normalizeNodeRecord({
        ...(node as Partial<NodeRecord>),
        nodeID: nodeID || (node as Partial<NodeRecord>)?.nodeID,
      });
      if (!normalized.nodeID) continue;
      nodes[normalized.nodeID] = normalized;
    }
    return {
      nodes,
      devices: parsed.devices ?? {},
      pairs: Array.isArray(parsed.pairs) ? parsed.pairs : [],
      invokes: parsed.invokes ?? {},
    };
  } catch {
    return {
      nodes: {},
      devices: {},
      pairs: [],
      invokes: {},
    };
  }
}

function writeStore(projectDir: string, store: NodeStore): void {
  const file = filePath(projectDir);
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function readStoreWithHealth(projectDir: string): NodeStore {
  const store = readStore(projectDir);
  if (applyHeartbeatHealth(store)) {
    writeStore(projectDir, store);
  }
  return store;
}

function verifyNodeToken(node: NodeRecord, token?: string): boolean {
  if (!node.tokenHash) return true;
  if (!token) return false;
  const expected = Buffer.from(node.tokenHash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function registerNode(
  projectDir: string,
  input: {
    nodeID: string;
    deviceID: string;
    type?: NodeType;
    platform: string;
    capabilities: string[];
    permissions?: Partial<NodePermissions>;
    token?: string;
  },
): NodeRecord {
  const store = readStoreWithHealth(projectDir);
  const existing = store.nodes[input.nodeID];
  if (existing && !verifyNodeToken(existing, input.token)) {
    throw new Error('node_token_invalid');
  }

  const nextCapabilities = [...new Set(input.capabilities)].sort();
  const now = nowIso();
  const createdAt = store.nodes[input.nodeID]?.createdAt ?? nowIso();
  const lastHeartbeatAt = now;
  const tokenLastUsedAt = existing?.tokenHash ? now : existing?.tokenLastUsedAt;
  const node: NodeRecord = {
    nodeID: input.nodeID,
    deviceID: input.deviceID,
    type: input.type ?? existing?.type ?? 'cli',
    role: 'node',
    platform: input.platform,
    permissions: inferPermissionsFromCapabilities(nextCapabilities, {
      ...existing?.permissions,
      ...(input.permissions ?? {}),
    }),
    capabilities: nextCapabilities,
    connected: true,
    paired: existing?.paired ?? false,
    status: 'online',
    tokenHash: existing?.tokenHash,
    tokenIssuedAt: existing?.tokenIssuedAt,
    tokenLastUsedAt,
    lastHeartbeatAt,
    lastSeenAt: now,
    createdAt,
    updatedAt: now,
  };
  store.nodes[input.nodeID] = node;

  const device: DeviceRecord = {
    deviceID: input.deviceID,
    label: store.devices[input.deviceID]?.label,
    approved: store.devices[input.deviceID]?.approved ?? false,
    createdAt: store.devices[input.deviceID]?.createdAt ?? now,
    updatedAt: now,
  };
  store.devices[input.deviceID] = device;

  writeStore(projectDir, store);
  return node;
}

export function touchNodeHeartbeat(projectDir: string, nodeID: string): NodeRecord | null {
  const store = readStore(projectDir);
  const node = store.nodes[nodeID];
  if (!node) return null;
  const now = nowIso();
  node.connected = true;
  node.status = 'online';
  node.lastHeartbeatAt = now;
  node.lastSeenAt = now;
  node.updatedAt = now;
  writeStore(projectDir, store);
  return node;
}

export function markNodeDisconnected(projectDir: string, nodeID: string): void {
  const store = readStore(projectDir);
  const node = store.nodes[nodeID];
  if (!node) return;
  node.connected = false;
  node.status = 'offline';
  node.updatedAt = nowIso();
  writeStore(projectDir, store);
}

export function listNodes(projectDir: string): NodeRecord[] {
  const store = readStoreWithHealth(projectDir);
  return Object.values(store.nodes).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function listDevices(projectDir: string): DeviceRecord[] {
  const store = readStoreWithHealth(projectDir);
  return Object.values(store.devices).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function describeNode(projectDir: string, nodeID: string): NodeRecord | null {
  const store = readStoreWithHealth(projectDir);
  return store.nodes[nodeID] ?? null;
}

export function issueNodeToken(
  projectDir: string,
  nodeID: string,
): { nodeID: string; token: string; issuedAt: string } | null {
  const store = readStoreWithHealth(projectDir);
  const node = store.nodes[nodeID];
  if (!node) return null;

  const token = `nkt_${randomBytes(24).toString('hex')}`;
  const issuedAt = nowIso();
  node.tokenHash = hashToken(token);
  node.tokenIssuedAt = issuedAt;
  node.tokenLastUsedAt = issuedAt;
  node.updatedAt = issuedAt;
  store.nodes[nodeID] = node;
  writeStore(projectDir, store);
  return { nodeID, token, issuedAt };
}

export function createNodePairRequest(
  projectDir: string,
  input: { nodeID: string; deviceID: string },
): NodePairRequest {
  const store = readStore(projectDir);
  const pending = store.pairs.find(
    (item) => item.nodeID === input.nodeID && item.status === 'pending',
  );
  if (pending) return pending;

  const pair: NodePairRequest = {
    id: `npair_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    nodeID: input.nodeID,
    deviceID: input.deviceID,
    status: 'pending',
    requestedAt: nowIso(),
  };
  store.pairs = [pair, ...store.pairs].slice(0, 1000);
  writeStore(projectDir, store);
  return pair;
}

export function listNodePairs(
  projectDir: string,
  status?: 'pending' | 'approved' | 'rejected',
): NodePairRequest[] {
  const store = readStore(projectDir);
  const pairs = status
    ? store.pairs.filter((item) => item.status === status)
    : store.pairs;
  return [...pairs].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

export function resolveNodePair(
  projectDir: string,
  pairID: string,
  status: 'approved' | 'rejected',
): NodePairRequest | null {
  const store = readStore(projectDir);
  const pair = store.pairs.find((item) => item.id === pairID);
  if (!pair || pair.status !== 'pending') return null;

  pair.status = status;
  pair.resolvedAt = nowIso();
  if (status === 'approved') {
    const node = store.nodes[pair.nodeID];
    if (node) {
      node.paired = true;
      node.updatedAt = nowIso();
    }
    const device = store.devices[pair.deviceID];
    if (device) {
      device.approved = true;
      device.updatedAt = nowIso();
    }
  }
  writeStore(projectDir, store);
  return pair;
}

export function createInvokeRequest(
  projectDir: string,
  input: {
    nodeID: string;
    capability: string;
    args: Record<string, unknown>;
  },
): NodeInvokeRequest {
  const store = readStore(projectDir);
  const invoke: NodeInvokeRequest = {
    id: `invoke_${randomUUID()}`,
    nodeID: input.nodeID,
    capability: input.capability,
    args: input.args,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  store.invokes[invoke.id] = invoke;
  writeStore(projectDir, store);
  return invoke;
}

export function markInvokeSent(projectDir: string, invokeID: string): NodeInvokeRequest | null {
  const store = readStore(projectDir);
  const invoke = store.invokes[invokeID];
  if (!invoke) return null;
  invoke.status = 'sent';
  invoke.updatedAt = nowIso();
  writeStore(projectDir, store);
  return invoke;
}

export function resolveInvokeResult(
  projectDir: string,
  invokeID: string,
  input: {
    ok: boolean;
    result?: Record<string, unknown>;
    error?: string;
  },
): NodeInvokeRequest | null {
  const store = readStore(projectDir);
  const invoke = store.invokes[invokeID];
  if (!invoke) return null;

  invoke.status = input.ok ? 'completed' : 'failed';
  invoke.result = input.result;
  invoke.error = input.error;
  invoke.updatedAt = nowIso();
  writeStore(projectDir, store);
  return invoke;
}

export function listInvokeRequests(projectDir: string, limit = 50): NodeInvokeRequest[] {
  const store = readStore(projectDir);
  return Object.values(store.invokes)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, Math.max(1, limit));
}
