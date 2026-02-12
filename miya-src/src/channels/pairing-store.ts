import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../workflow';
import type { ChannelName, ChannelPairRequest, ChannelState, ChannelStore } from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function filePath(projectDir: string): string {
  return path.join(getMiyaRuntimeDir(projectDir), 'channels.json');
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function defaultChannelState(name: ChannelName): ChannelState {
  return {
    name,
    enabled: name === 'webchat',
    connected: name === 'webchat',
    updatedAt: nowIso(),
    allowlist: [],
  };
}

function defaultStore(): ChannelStore {
  return {
    channels: {
      telegram: defaultChannelState('telegram'),
      slack: defaultChannelState('slack'),
      webchat: defaultChannelState('webchat'),
    },
    pairs: [],
  };
}

export function readChannelStore(projectDir: string): ChannelStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return defaultStore();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ChannelStore>;
    const fallback = defaultStore();
    return {
      channels: {
        telegram: {
          ...fallback.channels.telegram,
          ...(parsed.channels?.telegram ?? {}),
        },
        slack: {
          ...fallback.channels.slack,
          ...(parsed.channels?.slack ?? {}),
        },
        webchat: {
          ...fallback.channels.webchat,
          ...(parsed.channels?.webchat ?? {}),
        },
      },
      pairs: Array.isArray(parsed.pairs) ? parsed.pairs : [],
    };
  } catch {
    return defaultStore();
  }
}

export function writeChannelStore(projectDir: string, store: ChannelStore): void {
  const file = filePath(projectDir);
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

export function listChannelStates(projectDir: string): ChannelState[] {
  const store = readChannelStore(projectDir);
  return Object.values(store.channels).sort((a, b) => a.name.localeCompare(b.name));
}

export function upsertChannelState(
  projectDir: string,
  name: ChannelName,
  patch: Partial<Omit<ChannelState, 'name'>>,
): ChannelState {
  const store = readChannelStore(projectDir);
  const next: ChannelState = {
    ...store.channels[name],
    ...patch,
    name,
    updatedAt: nowIso(),
  };
  store.channels[name] = next;
  writeChannelStore(projectDir, store);
  return next;
}

export function ensurePairRequest(
  projectDir: string,
  input: {
    channel: ChannelName;
    senderID: string;
    displayName?: string;
    messagePreview?: string;
  },
): ChannelPairRequest {
  const store = readChannelStore(projectDir);
  const existing = store.pairs.find(
    (item) =>
      item.channel === input.channel &&
      item.senderID === input.senderID &&
      item.status === 'pending',
  );
  if (existing) return existing;

  const next: ChannelPairRequest = {
    id: `pair_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    channel: input.channel,
    senderID: input.senderID,
    displayName: input.displayName,
    messagePreview: input.messagePreview,
    status: 'pending',
    requestedAt: nowIso(),
  };
  store.pairs = [next, ...store.pairs].slice(0, 1000);
  writeChannelStore(projectDir, store);
  return next;
}

export function resolvePairRequest(
  projectDir: string,
  pairID: string,
  status: 'approved' | 'rejected',
): ChannelPairRequest | null {
  const store = readChannelStore(projectDir);
  const pair = store.pairs.find((item) => item.id === pairID);
  if (!pair || pair.status !== 'pending') return null;

  pair.status = status;
  pair.resolvedAt = nowIso();

  if (status === 'approved') {
    const channel = store.channels[pair.channel];
    if (!channel.allowlist.includes(pair.senderID)) {
      channel.allowlist = [...channel.allowlist, pair.senderID].sort();
      channel.updatedAt = nowIso();
    }
  }

  writeChannelStore(projectDir, store);
  return pair;
}

export function listPairRequests(
  projectDir: string,
  status?: 'pending' | 'approved' | 'rejected',
): ChannelPairRequest[] {
  const store = readChannelStore(projectDir);
  const pairs = status
    ? store.pairs.filter((item) => item.status === status)
    : store.pairs;
  return [...pairs].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

export function isSenderAllowed(
  projectDir: string,
  channel: ChannelName,
  senderID: string,
): boolean {
  const store = readChannelStore(projectDir);
  const allowed = store.channels[channel].allowlist;
  return allowed.includes(senderID);
}
