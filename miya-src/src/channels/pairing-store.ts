import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from '../security/system-keyring';
import { getMiyaRuntimeDir } from '../workflow';
import {
  CHANNEL_NAMES,
  type ChannelName,
  type ChannelPairRequest,
  type ChannelState,
  type ChannelStore,
} from './types';

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
    contactTiers: {},
  };
}

function defaultStore(): ChannelStore {
  const channels = {} as Record<ChannelName, ChannelState>;
  for (const name of CHANNEL_NAMES) {
    channels[name] = defaultChannelState(name);
  }
  return { channels, pairs: [] };
}

export function readChannelStore(projectDir: string): ChannelStore {
  const file = filePath(projectDir);
  if (!fs.existsSync(file)) {
    return defaultStore();
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, 'utf-8'),
    ) as Partial<ChannelStore>;
    const fallback = defaultStore();
    const mergedChannels = {} as Record<ChannelName, ChannelState>;
    for (const name of CHANNEL_NAMES) {
      const channel = {
        ...fallback.channels[name],
        ...(parsed.channels?.[name] ?? {}),
      };
      const allowlist = Array.isArray(channel.allowlist)
        ? channel.allowlist.map((item) =>
            decryptSensitiveValue(projectDir, String(item)),
          )
        : [];
      const contactTiersRaw =
        channel.contactTiers && typeof channel.contactTiers === 'object'
          ? channel.contactTiers
          : {};
      const contactTiers: Record<string, 'owner' | 'friend'> = {};
      for (const [senderID, tier] of Object.entries(contactTiersRaw)) {
        const decoded = decryptSensitiveValue(projectDir, senderID);
        if (tier === 'owner' || tier === 'friend') {
          contactTiers[decoded] = tier;
        }
      }
      mergedChannels[name] = {
        ...channel,
        allowlist,
        contactTiers,
      };
    }
    const pairs = Array.isArray(parsed.pairs) ? parsed.pairs : [];
    return {
      channels: mergedChannels,
      pairs: pairs.map((pair) => ({
        ...pair,
        senderID: decryptSensitiveValue(projectDir, pair.senderID),
        displayName: pair.displayName
          ? decryptSensitiveValue(projectDir, pair.displayName)
          : pair.displayName,
        messagePreview: pair.messagePreview
          ? decryptSensitiveValue(projectDir, pair.messagePreview)
          : pair.messagePreview,
      })),
    };
  } catch {
    return defaultStore();
  }
}

export function writeChannelStore(
  projectDir: string,
  store: ChannelStore,
): void {
  const file = filePath(projectDir);
  ensureDir(file);
  const encrypted: ChannelStore = {
    channels: Object.fromEntries(
      Object.entries(store.channels).map(([name, state]) => {
        const contactTiers: Record<string, 'owner' | 'friend'> = {};
        for (const [senderID, tier] of Object.entries(
          state.contactTiers ?? {},
        )) {
          contactTiers[encryptSensitiveValue(projectDir, senderID)] = tier;
        }
        return [
          name,
          {
            ...state,
            allowlist: state.allowlist.map((item) =>
              encryptSensitiveValue(projectDir, item),
            ),
            contactTiers,
          },
        ];
      }),
    ) as ChannelStore['channels'],
    pairs: store.pairs.map((pair) => ({
      ...pair,
      senderID: encryptSensitiveValue(projectDir, pair.senderID),
      displayName: pair.displayName
        ? encryptSensitiveValue(projectDir, pair.displayName)
        : pair.displayName,
      messagePreview: pair.messagePreview
        ? encryptSensitiveValue(projectDir, pair.messagePreview)
        : pair.messagePreview,
    })),
  };
  fs.writeFileSync(file, `${JSON.stringify(encrypted, null, 2)}\n`, 'utf-8');
}

export function listChannelStates(projectDir: string): ChannelState[] {
  const store = readChannelStore(projectDir);
  return Object.values(store.channels).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
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
    const ownerByEnv = new Set(
      String(process.env.MIYA_OWNER_IDS ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
    if (!channel.allowlist.includes(pair.senderID)) {
      channel.allowlist = [...channel.allowlist, pair.senderID].sort();
    }
    const currentTier = channel.contactTiers?.[pair.senderID];
    const resolvedTier =
      currentTier ?? (ownerByEnv.has(pair.senderID) ? 'owner' : 'friend');
    channel.contactTiers = {
      ...(channel.contactTiers ?? {}),
      [pair.senderID]: resolvedTier,
    };
    channel.updatedAt = nowIso();
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
  return [...pairs].sort(
    (a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt),
  );
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

export function getContactTier(
  projectDir: string,
  channel: ChannelName,
  senderID: string,
): 'owner' | 'friend' | null {
  const store = readChannelStore(projectDir);
  const state = store.channels[channel];
  if (!state.allowlist.includes(senderID)) return null;
  return state.contactTiers?.[senderID] ?? 'friend';
}

export function setContactTier(
  projectDir: string,
  channel: ChannelName,
  senderID: string,
  tier: 'owner' | 'friend',
): ChannelState {
  const store = readChannelStore(projectDir);
  const state = store.channels[channel];
  const allowlist = state.allowlist.includes(senderID)
    ? state.allowlist
    : [...state.allowlist, senderID].sort();
  const next: ChannelState = {
    ...state,
    allowlist,
    contactTiers: {
      ...(state.contactTiers ?? {}),
      [senderID]: tier,
    },
    updatedAt: nowIso(),
  };
  store.channels[channel] = next;
  writeChannelStore(projectDir, store);
  return next;
}

export function listContactTiers(
  projectDir: string,
  channel?: ChannelName,
): Array<{ channel: ChannelName; senderID: string; tier: 'owner' | 'friend' }> {
  const store = readChannelStore(projectDir);
  const channels = channel ? [channel] : [...CHANNEL_NAMES];
  const rows: Array<{
    channel: ChannelName;
    senderID: string;
    tier: 'owner' | 'friend';
  }> = [];
  for (const name of channels) {
    const state = store.channels[name];
    const mapping = state.contactTiers ?? {};
    for (const senderID of state.allowlist) {
      rows.push({
        channel: name,
        senderID,
        tier: mapping[senderID] ?? 'friend',
      });
    }
  }
  return rows.sort((a, b) =>
    `${a.channel}:${a.senderID}`.localeCompare(`${b.channel}:${b.senderID}`),
  );
}
