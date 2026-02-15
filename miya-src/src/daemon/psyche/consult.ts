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

export interface PsycheOutcomeRequest {
  consultAuditID: string;
  intent: string;
  urgency?: PsycheUrgency;
  channel?: string;
  userInitiated?: boolean;
  state: SentinelState;
  delivered: boolean;
  blockedReason?: string;
  explicitFeedback?: 'positive' | 'negative' | 'none';
  userReplyWithinSec?: number;
}

export interface PsycheOutcomeResult {
  at: string;
  consultAuditID: string;
  reward: 'positive' | 'negative';
  score: number;
  bucket: string;
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
const DEFAULT_BUDGETS: Record<
  SentinelState,
  {
    maxActions: number;
    windowSec: number;
  }
> = {
  FOCUS: { maxActions: 1, windowSec: 3600 },
  CONSUME: { maxActions: 1, windowSec: 2400 },
  PLAY: { maxActions: 0, windowSec: 3600 },
  AWAY: { maxActions: 2, windowSec: 3600 },
  UNKNOWN: { maxActions: 0, windowSec: 1800 },
};

interface InterruptionBudgetState {
  windowStartedAt: string;
  used: number;
}

interface InterruptionBudgetStore {
  byState: Partial<Record<SentinelState, InterruptionBudgetState>>;
}

interface RandomSource {
  next(): number;
}

const defaultRandomSource: RandomSource = {
  next: () => Math.random(),
};

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
  private readonly budgetPath: string;
  private readonly trainingDataLogPath: string;
  private readonly epsilon: number;
  private readonly random: RandomSource;

  constructor(
    private readonly projectDir: string,
    options?: {
      epsilon?: number;
      random?: RandomSource;
    },
  ) {
    const psycheDir = path.join(getMiyaRuntimeDir(projectDir), 'daemon', 'psyche');
    fs.mkdirSync(psycheDir, { recursive: true });
    this.fastBrainPath = path.join(psycheDir, 'fast-brain.json');
    this.consultLogPath = path.join(psycheDir, 'consult.jsonl');
    this.budgetPath = path.join(psycheDir, 'interruption-budget.json');
    this.trainingDataLogPath = path.join(psycheDir, 'training-data.jsonl');
    this.epsilon = Math.max(0, Math.min(0.1, options?.epsilon ?? this.resolveEpsilonFromEnv()));
    this.random = options?.random ?? defaultRandomSource;
  }

  consult(input: PsycheConsultRequest): PsycheConsultResult {
    const intent = String(input.intent ?? '').trim() || 'unknown_intent';
    const urgency = asUrgency(input.urgency);
    const userInitiated = input.userInitiated !== false;
    const sentinel = inferSentinelState(input.signals);
    const state = sentinel.state;
    const auditID = randomUUID();
    const at = nowIso();

    const fastBrainScore = this.readFastBrainScore({
      state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
    });

    const decisionSeed = this.pickDecision({
      state,
      urgency,
      intent,
      userInitiated,
      shouldProbeScreen: sentinel.shouldProbeScreen,
      fastBrainScore,
    });

    let decision = decisionSeed;
    let budgetHint = '';
    if (!userInitiated) {
      const budget = this.applyInterruptionBudget(state, decision === 'allow');
      if (decision === 'allow' && budget.blocked) {
        decision = 'defer';
        budgetHint = `budget_exhausted:${state}`;
      }
    }

    let explorationApplied = false;
    if (!userInitiated && decision === 'defer' && this.shouldExplore()) {
      decision = 'allow';
      explorationApplied = true;
    }

    const reason = this.buildReason({
      decision,
      state,
      userInitiated,
      urgency,
      intent,
      reasons: [
        ...sentinel.reasons,
        `fast_brain_score=${fastBrainScore.toFixed(2)}`,
        budgetHint,
        explorationApplied ? 'epsilon_exploration' : '',
      ].filter((item) => item.length > 0),
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
    this.appendTrainingObservation({
      at,
      state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
      confidence: sentinel.confidence,
      decision,
      shouldProbeScreen: sentinel.shouldProbeScreen,
      reasons: sentinel.reasons,
      signals: input.signals,
    });
    return result;
  }

  registerOutcome(input: PsycheOutcomeRequest): PsycheOutcomeResult {
    const at = nowIso();
    const intent = String(input.intent ?? '').trim() || 'unknown_intent';
    const urgency = asUrgency(input.urgency);
    const userInitiated = input.userInitiated !== false;
    const feedback = input.explicitFeedback ?? 'none';
    const score = this.outcomeScore({
      delivered: input.delivered,
      blockedReason: input.blockedReason,
      explicitFeedback: feedback,
      userReplyWithinSec: input.userReplyWithinSec,
    });
    const reward = score >= 0 ? 'positive' : 'negative';
    const key = fastBrainBucket({
      state: input.state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
    });
    this.adjustFastBrain(key, reward === 'positive' ? Math.abs(score) : 0, reward === 'negative' ? Math.abs(score) : 0);
    this.appendTrainingOutcome({
      at,
      consultAuditID: input.consultAuditID,
      state: input.state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
      delivered: input.delivered,
      blockedReason: input.blockedReason,
      explicitFeedback: feedback,
      userReplyWithinSec: input.userReplyWithinSec,
      score,
      reward,
    });
    return {
      at,
      consultAuditID: input.consultAuditID,
      reward,
      score,
      bucket: key,
    };
  }

  private pickDecision(input: {
    state: SentinelState;
    urgency: PsycheUrgency;
    intent: string;
    userInitiated: boolean;
    shouldProbeScreen: boolean;
    fastBrainScore: number;
  }): PsycheDecision {
    const { state, urgency, userInitiated, shouldProbeScreen, fastBrainScore } = input;
    if (userInitiated) {
      if (state === 'UNKNOWN' && urgency === 'low') return 'defer';
      return 'allow';
    }

    if (shouldProbeScreen && urgency !== 'critical') return 'defer';
    if (urgency === 'critical') return 'allow';
    if (state === 'FOCUS' || state === 'PLAY' || state === 'UNKNOWN') return 'defer';
    if (state === 'CONSUME') {
      if (urgency === 'high') return fastBrainScore >= 0.35 ? 'allow' : 'defer';
      return fastBrainScore >= 0.6 ? 'allow' : 'defer';
    }
    return fastBrainScore >= 0.3 ? 'allow' : 'defer';
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

  private appendTrainingObservation(input: {
    at: string;
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    confidence: number;
    decision: PsycheDecision;
    shouldProbeScreen: boolean;
    reasons: string[];
    signals?: SentinelSignals;
  }): void {
    fs.appendFileSync(
      this.trainingDataLogPath,
      `${JSON.stringify({
        t: Math.floor(Date.now() / 1000),
        type: 'observation',
        obs: {
          at: input.at,
          state: input.state,
          intent: input.intent,
          urgency: input.urgency,
          channel: input.channel ?? 'none',
          userInitiated: input.userInitiated,
          confidence: input.confidence,
          decision: input.decision,
          shouldProbeScreen: input.shouldProbeScreen,
          reasons: input.reasons,
          signals: input.signals ?? {},
        },
      })}\n`,
      'utf-8',
    );
  }

  private appendTrainingOutcome(input: {
    at: string;
    consultAuditID: string;
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
    delivered: boolean;
    blockedReason?: string;
    explicitFeedback: 'positive' | 'negative' | 'none';
    userReplyWithinSec?: number;
    score: number;
    reward: 'positive' | 'negative';
  }): void {
    fs.appendFileSync(
      this.trainingDataLogPath,
      `${JSON.stringify({
        t: Math.floor(Date.now() / 1000),
        type: 'action_outcome',
        action: {
          at: input.at,
          consultAuditID: input.consultAuditID,
          state: input.state,
          intent: input.intent,
          urgency: input.urgency,
          channel: input.channel ?? 'none',
          userInitiated: input.userInitiated,
          delivered: input.delivered,
          blockedReason: input.blockedReason ?? '',
          explicitFeedback: input.explicitFeedback,
          userReplyWithinSec: input.userReplyWithinSec,
          score: Number(input.score.toFixed(3)),
          reward: input.reward,
        },
      })}\n`,
      'utf-8',
    );
  }

  private resolveEpsilonFromEnv(): number {
    const raw = Number(process.env.MIYA_PSYCHE_EPSILON ?? 0.01);
    if (!Number.isFinite(raw)) return 0.01;
    return raw;
  }

  private shouldExplore(): boolean {
    if (this.epsilon <= 0) return false;
    return this.random.next() < this.epsilon;
  }

  private readFastBrainScore(input: {
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    userInitiated: boolean;
  }): number {
    const store = safeReadJson<FastBrainStore>(this.fastBrainPath, DEFAULT_FAST_BRAIN);
    const key = fastBrainBucket(input);
    const stats = store.buckets[key];
    if (!stats) return 0.5;
    const alpha = Number.isFinite(stats.alpha) ? stats.alpha : 1;
    const beta = Number.isFinite(stats.beta) ? stats.beta : 1;
    const total = alpha + beta;
    if (!Number.isFinite(total) || total <= 0) return 0.5;
    return Math.max(0, Math.min(1, alpha / total));
  }

  private adjustFastBrain(key: string, alphaDelta: number, betaDelta: number): void {
    const store = safeReadJson<FastBrainStore>(this.fastBrainPath, DEFAULT_FAST_BRAIN);
    const current = store.buckets[key] ?? {
      alpha: 1,
      beta: 1,
      updatedAt: nowIso(),
    };
    const alpha = Number.isFinite(current.alpha) ? current.alpha : 1;
    const beta = Number.isFinite(current.beta) ? current.beta : 1;
    current.alpha = Math.max(1, alpha + Math.max(0, alphaDelta));
    current.beta = Math.max(1, beta + Math.max(0, betaDelta));
    current.updatedAt = nowIso();
    store.buckets[key] = current;
    fs.writeFileSync(this.fastBrainPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  }

  private outcomeScore(input: {
    delivered: boolean;
    blockedReason?: string;
    explicitFeedback: 'positive' | 'negative' | 'none';
    userReplyWithinSec?: number;
  }): number {
    if (input.explicitFeedback === 'negative') return -1;
    if (input.explicitFeedback === 'positive') return 1;
    if (!input.delivered) {
      return input.blockedReason ? -0.6 : -0.4;
    }
    if (typeof input.userReplyWithinSec === 'number' && input.userReplyWithinSec > 0) {
      if (input.userReplyWithinSec <= 180) return 0.8;
      if (input.userReplyWithinSec <= 600) return 0.4;
    }
    return 0.2;
  }

  private applyInterruptionBudget(
    state: SentinelState,
    consumeToken: boolean,
  ): { blocked: boolean } {
    const policy = DEFAULT_BUDGETS[state] ?? DEFAULT_BUDGETS.UNKNOWN;
    if (policy.maxActions <= 0) {
      return { blocked: true };
    }
    const now = Date.now();
    const store = safeReadJson<InterruptionBudgetStore>(this.budgetPath, { byState: {} });
    const current = store.byState[state];
    let active: InterruptionBudgetState;
    if (!current) {
      active = { windowStartedAt: nowIso(), used: 0 };
    } else {
      const startedAtMs = Date.parse(current.windowStartedAt);
      if (!Number.isFinite(startedAtMs) || now - startedAtMs >= policy.windowSec * 1000) {
        active = { windowStartedAt: nowIso(), used: 0 };
      } else {
        active = {
          windowStartedAt: current.windowStartedAt,
          used: Math.max(0, Math.floor(current.used ?? 0)),
        };
      }
    }
    const blocked = active.used >= policy.maxActions;
    if (!blocked && consumeToken) {
      active.used += 1;
    }
    store.byState[state] = active;
    fs.writeFileSync(this.budgetPath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
    return { blocked };
  }
}
