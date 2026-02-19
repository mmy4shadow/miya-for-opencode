import * as fs from 'node:fs';

export type InteractionEventType = 'consult' | 'outcome';

export interface InteractionEvent {
  atMs: number;
  type: InteractionEventType;
  channel?: string;
  userInitiated?: boolean;
  decision?: 'allow' | 'defer' | 'deny';
  delivered?: boolean;
  explicitFeedback?: 'positive' | 'negative' | 'none';
  userReplyWithinSec?: number;
}

export interface InteractionStatsSnapshot {
  generatedAtMs: number;
  window1h: {
    consults: number;
    proactiveAllows: number;
    proactiveDefers: number;
    userInitiatedTurns: number;
  };
  window24h: {
    consults: number;
    proactiveAllows: number;
    proactiveDefers: number;
    userInitiatedTurns: number;
    outcomes: number;
    delivered: number;
    negativeFeedback: number;
    positiveFeedback: number;
    replyRate: number;
    medianReplySec?: number;
    userInitiatedRate: number;
    negativeFeedbackRate: number;
  };
}

interface InteractionStatsStore {
  version: 1;
  updatedAt: string;
  events: InteractionEvent[];
}

const MAX_EVENTS = 8_000;
const MAX_RETENTION_MS = 30 * 24 * 3600 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function toSafeAtMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeEvent(raw: unknown, fallbackAtMs: number): InteractionEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const type = row.type === 'consult' || row.type === 'outcome' ? row.type : null;
  if (!type) return null;
  const atMs = toSafeAtMs(row.atMs, fallbackAtMs);
  return {
    atMs,
    type,
    channel: typeof row.channel === 'string' ? row.channel : undefined,
    userInitiated: typeof row.userInitiated === 'boolean' ? row.userInitiated : undefined,
    decision:
      row.decision === 'allow' || row.decision === 'defer' || row.decision === 'deny'
        ? row.decision
        : undefined,
    delivered: typeof row.delivered === 'boolean' ? row.delivered : undefined,
    explicitFeedback:
      row.explicitFeedback === 'positive' ||
      row.explicitFeedback === 'negative' ||
      row.explicitFeedback === 'none'
        ? row.explicitFeedback
        : undefined,
    userReplyWithinSec:
      typeof row.userReplyWithinSec === 'number' && Number.isFinite(row.userReplyWithinSec)
        ? row.userReplyWithinSec
        : undefined,
  };
}

function normalizeStore(raw: unknown): InteractionStatsStore {
  const nowMs = Date.now();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      version: 1,
      updatedAt: nowIso(),
      events: [],
    };
  }
  const row = raw as Record<string, unknown>;
  const eventsRaw = Array.isArray(row.events) ? row.events : [];
  const events = eventsRaw
    .map((event) => normalizeEvent(event, nowMs))
    .filter((event): event is InteractionEvent => Boolean(event))
    .sort((a, b) => a.atMs - b.atMs);
  return {
    version: 1,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
    events,
  };
}

function readStore(filePath: string): InteractionStatsStore {
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      updatedAt: nowIso(),
      events: [],
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return normalizeStore(parsed);
  } catch {
    return {
      version: 1,
      updatedAt: nowIso(),
      events: [],
    };
  }
}

function writeStore(filePath: string, store: InteractionStatsStore): void {
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function trimEvents(events: InteractionEvent[], nowMs: number): InteractionEvent[] {
  const lowerBound = nowMs - MAX_RETENTION_MS;
  const bounded = events.filter((event) => event.atMs >= lowerBound);
  if (bounded.length <= MAX_EVENTS) return bounded;
  return bounded.slice(bounded.length - MAX_EVENTS);
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function appendInteractionEvent(
  filePath: string,
  event: InteractionEvent,
  nowMs = Date.now(),
): InteractionStatsSnapshot {
  const store = readStore(filePath);
  const normalized = normalizeEvent(event, nowMs);
  if (!normalized) return readInteractionStats(filePath, nowMs);
  const trimmed = trimEvents([...store.events, normalized], nowMs);
  const next: InteractionStatsStore = {
    version: 1,
    updatedAt: nowIso(),
    events: trimmed,
  };
  writeStore(filePath, next);
  return readInteractionStats(filePath, nowMs);
}

export function readInteractionStats(
  filePath: string,
  nowMs = Date.now(),
): InteractionStatsSnapshot {
  const store = readStore(filePath);
  const events = trimEvents(store.events, nowMs);
  if (events.length !== store.events.length) {
    writeStore(filePath, {
      version: 1,
      updatedAt: nowIso(),
      events,
    });
  }
  const since1h = nowMs - 3600 * 1000;
  const since24h = nowMs - 24 * 3600 * 1000;
  const in1h = events.filter((event) => event.atMs >= since1h);
  const in24h = events.filter((event) => event.atMs >= since24h);
  const consults1h = in1h.filter((event) => event.type === 'consult');
  const consults24h = in24h.filter((event) => event.type === 'consult');
  const outcomes24h = in24h.filter((event) => event.type === 'outcome');
  const delivered24h = outcomes24h.filter((event) => event.delivered === true);
  const replies = delivered24h
    .map((event) =>
      typeof event.userReplyWithinSec === 'number' && event.userReplyWithinSec > 0
        ? event.userReplyWithinSec
        : undefined,
    )
    .filter((value): value is number => typeof value === 'number');
  const negativeFeedback = outcomes24h.filter(
    (event) => event.explicitFeedback === 'negative',
  ).length;
  const positiveFeedback = outcomes24h.filter(
    (event) => event.explicitFeedback === 'positive',
  ).length;
  const proactiveAllows1h = consults1h.filter(
    (event) => event.userInitiated === false && event.decision === 'allow',
  ).length;
  const proactiveDefers1h = consults1h.filter(
    (event) => event.userInitiated === false && event.decision === 'defer',
  ).length;
  const proactiveAllows24h = consults24h.filter(
    (event) => event.userInitiated === false && event.decision === 'allow',
  ).length;
  const proactiveDefers24h = consults24h.filter(
    (event) => event.userInitiated === false && event.decision === 'defer',
  ).length;
  const userInitiatedTurns1h = consults1h.filter((event) => event.userInitiated !== false).length;
  const userInitiatedTurns24h = consults24h.filter(
    (event) => event.userInitiated !== false,
  ).length;
  return {
    generatedAtMs: nowMs,
    window1h: {
      consults: consults1h.length,
      proactiveAllows: proactiveAllows1h,
      proactiveDefers: proactiveDefers1h,
      userInitiatedTurns: userInitiatedTurns1h,
    },
    window24h: {
      consults: consults24h.length,
      proactiveAllows: proactiveAllows24h,
      proactiveDefers: proactiveDefers24h,
      userInitiatedTurns: userInitiatedTurns24h,
      outcomes: outcomes24h.length,
      delivered: delivered24h.length,
      negativeFeedback,
      positiveFeedback,
      replyRate:
        delivered24h.length > 0
          ? clampRate(replies.length / delivered24h.length)
          : 0,
      medianReplySec: median(replies),
      userInitiatedRate:
        consults24h.length > 0 ? clampRate(userInitiatedTurns24h / consults24h.length) : 0,
      negativeFeedbackRate:
        outcomes24h.length > 0 ? clampRate(negativeFeedback / outcomes24h.length) : 0,
    },
  };
}

