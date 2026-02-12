import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getMiyaRuntimeDir } from '../workflow';

export interface NodeRecord {
  nodeID: string;
  deviceID: string;
  role: 'node';
  platform: string;
  capabilities: string[];
  connected: boolean;
  paired: boolean;
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

function nowIso(): string {
  return new Date().toISOString();
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
    return {
      nodes: parsed.nodes ?? {},
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

export function registerNode(
  projectDir: string,
  input: {
    nodeID: string;
    deviceID: string;
    platform: string;
    capabilities: string[];
  },
): NodeRecord {
  const store = readStore(projectDir);
  const createdAt = store.nodes[input.nodeID]?.createdAt ?? nowIso();
  const node: NodeRecord = {
    nodeID: input.nodeID,
    deviceID: input.deviceID,
    role: 'node',
    platform: input.platform,
    capabilities: [...new Set(input.capabilities)].sort(),
    connected: true,
    paired: store.nodes[input.nodeID]?.paired ?? false,
    lastSeenAt: nowIso(),
    createdAt,
    updatedAt: nowIso(),
  };
  store.nodes[input.nodeID] = node;

  const device: DeviceRecord = {
    deviceID: input.deviceID,
    label: store.devices[input.deviceID]?.label,
    approved: store.devices[input.deviceID]?.approved ?? false,
    createdAt: store.devices[input.deviceID]?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  store.devices[input.deviceID] = device;

  writeStore(projectDir, store);
  return node;
}

export function markNodeDisconnected(projectDir: string, nodeID: string): void {
  const store = readStore(projectDir);
  const node = store.nodes[nodeID];
  if (!node) return;
  node.connected = false;
  node.updatedAt = nowIso();
  writeStore(projectDir, store);
}

export function listNodes(projectDir: string): NodeRecord[] {
  const store = readStore(projectDir);
  return Object.values(store.nodes).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function listDevices(projectDir: string): DeviceRecord[] {
  const store = readStore(projectDir);
  return Object.values(store.devices).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function describeNode(projectDir: string, nodeID: string): NodeRecord | null {
  const store = readStore(projectDir);
  return store.nodes[nodeID] ?? null;
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
