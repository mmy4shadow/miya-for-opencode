import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../workflow';
import { inferSentinelState, type SentinelSignals, type SentinelState } from './state-machine';

export type PsycheUrgency = 'low' | 'medium' | 'high' | 'critical';
export type PsycheDecision = 'allow' | 'defer' | 'deny';

export interface PsycheConsultRequest {
  intent: string;
  urgency?: PsycheUrgency;
  channel?: string;
  userInitiated?: boolean;
  signals?: SentinelSignals;
}

export interface PsycheConsultResult {
  auditID: string;
  at: string;
  intent: string;
  urgency: PsycheUrgency;
  channel?: string;
  userInitiated: boolean;
  state: SentinelState;
  confidence: number;
  decision: PsycheDecision;
  reason: string;
  retryAfterSec: number;
  shouldProbeScreen: boolean;
  reasons: string[];
}

interface BucketStats {
  alpha: number;
  beta: number;
  updatedAt: string;
}

interface FastBrainStore {
  buckets: Record<string, BucketStats>;
}

const DEFAULT_FAST_BRAIN: FastBrainStore = { buckets: {} };
const MAX_BUCKETS = 1200;

function nowIso(): string {
  return new Date().toISOString();
}

function safeReadJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function asUrgency(value: unknown): PsycheUrgency {
  return value === 'low' || value === 'high' || value === 'critical' ? value : 'medium';
}

function fastBrainBucket(input: {
  state: SentinelState;
  intent: string;
  urgency: PsycheUrgency;
  channel?: string;
  userInitiated: boolean;
}): string {
  const normalizedIntent = input.intent.trim().toLowerCase() || 'unknown_intent';
  const channel = (input.channel || 'none').trim().toLowerCase() || 'none';
  return [
    `state=${input.state}`,
    `intent=${normalizedIntent}`,
    `urgency=${input.urgency}`,
    `channel=${channel}`,
    `user=${input.userInitiated ? '1' : '0'}`,
  ].join('|');
}

export class PsycheConsultService {
  private readonly fastBrainPath: string;
  private readonly consultLogPath: string;

  constructor(private readonly projectDir: string) {
    const psycheDir = path.join(getMiyaRuntimeDir(projectDir), 'daemon', 'psyche');
    fs.mkdirSync(psycheDir, { recursive: true });
    this.fastBrainPath = path.join(psycheDir, 'fast-brain.json');
    this.consultLogPath = path.join(psycheDir, 'consult.jsonl');
  }

  consult(input: PsycheConsultRequest): PsycheConsultResult {
    const intent = String(input.intent ?? '').trim() || 'unknown_intent';
    const urgency = asUrgency(input.urgency);
    const userInitiated = input.userInitiated !== false;
    const sentinel = inferSentinelState(input.signals);
    const state = sentinel.state;
    const auditID = randomUUID();
    const at = nowIso();

    const decision = this.pickDecision({
      state,
      urgency,
      intent,
      userInitiated,
    });

    const reason = this.buildReason({
      decision,
      state,
      userInitiated,
      urgency,
      intent,
      reasons: sentinel.reasons,
    });

    const result: PsycheConsultResult = {
      auditID,
      at,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
      state,
      confidence: sentinel.confidence,
      decision,
      reason,
      retryAfterSec: decision === 'allow' ? 0 : urgency === 'critical' ? 10 : 90,
      shouldProbeScreen: sentinel.shouldProbeScreen,
      reasons: sentinel.reasons,
    };

    this.touchFastBrain({
      state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
      approved: decision === 'allow',
    });
    this.appendConsultLog(result);
    return result;
  }

  private pickDecision(input: {
    state: SentinelState;
    urgency: PsycheUrgency;
    intent: string;
    userInitiated: boolean;
  }): PsycheDecision {
    const { state, urgency, userInitiated } = input;
    if (userInitiated) {
      if (state === 'UNKNOWN' && urgency === 'low') return 'defer';
      return 'allow';
    }

    if (urgency === 'critical') return 'allow';
    if (state === 'FOCUS' || state === 'PLAY' || state === 'UNKNOWN') return 'defer';
    if (state === 'CONSUME') return urgency === 'high' ? 'allow' : 'defer';
    return 'allow';
  }

  private buildReason(input: {
    decision: PsycheDecision;
    state: SentinelState;
    userInitiated: boolean;
    urgency: PsycheUrgency;
    intent: string;
    reasons: string[];
  }): string {
    const base = `psyche_${input.decision.toLowerCase()}`;
    const markers = [
      `state=${input.state}`,
      `urgency=${input.urgency}`,
      `user_initiated=${input.userInitiated ? '1' : '0'}`,
      `intent=${input.intent}`,
    ];
    if (input.reasons.length > 0) {
      markers.push(`signals=${input.reasons.join(',')}`);
    }
    return `${base}:${markers.join(';')}`;
  }

  private touchFastBrain(input: {
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    approved: boolean;
  }): void {
    const store = safeReadJson<FastBrainStore>(this.fastBrainPath, DEFAULT_FAST_BRAIN);
    const key = fastBrainBucket(input);
    const current = store.buckets[key] ?? {
      alpha: 1,
      beta: 1,
      updatedAt: nowIso(),
    };
    if (input.approved) {
      current.alpha += 1;
    } else {
      current.beta += 1;
    }
    current.updatedAt = nowIso();
    store.buckets[key] = current;

    const keys = Object.keys(store.buckets);
    if (keys.length > MAX_BUCKETS) {
      keys
        .sort((a, b) => Date.parse(store.buckets[a].updatedAt) - Date.parse(store.buckets[b].updatedAt))
        .slice(0, keys.length - MAX_BUCKETS)
        .forEach((keyToDelete) => {
          delete store.buckets[keyToDelete];
        });
    }

    fs.writeFileSync(this.fastBrainPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  }

  private appendConsultLog(result: PsycheConsultResult): void {
    fs.appendFileSync(this.consultLogPath, `${JSON.stringify(result)}\n`, 'utf-8');
  }
}
