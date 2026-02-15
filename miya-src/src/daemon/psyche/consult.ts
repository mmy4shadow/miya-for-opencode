import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMiyaRuntimeDir } from '../../workflow';
import { inferSentinelState, type SentinelSignals, type SentinelState } from './state-machine';
import {
  adjustFastBrain,
  fastBrainBucket,
  readFastBrainScore,
  touchFastBrain,
} from './bandit';
import { appendPsycheObservation, appendPsycheOutcome } from './logger';
import { consumeProbeBudget } from './probe-budget';
import {
  getTrustScore,
  trustTierFromScore,
  updateTrustScore,
  type TrustTier,
} from './trust';

export type PsycheUrgency = 'low' | 'medium' | 'high' | 'critical';
export type PsycheDecision = 'allow' | 'defer' | 'deny';

export interface PsycheConsultRequest {
  intent: string;
  urgency?: PsycheUrgency;
  channel?: string;
  userInitiated?: boolean;
  signals?: SentinelSignals;
  trust?: {
    target?: string;
    source?: string;
    action?: string;
    evidenceConfidence?: number;
  };
}

export type PsycheApprovalMode = 'silent_audit' | 'toast_gate' | 'modal_approval';
export type PsycheFixability = 'impossible' | 'rewrite' | 'reduce_scope' | 'need_evidence' | 'retry_later';

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
  approvalMode: PsycheApprovalMode;
  fixability: PsycheFixability;
  budget: {
    autoRetry: number;
    humanEdit: number;
  };
  trust: {
    target: number;
    source: number;
    action: number;
    minScore: number;
    tier: TrustTier;
  };
  insightText: string;
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
  trust?: {
    target?: string;
    source?: string;
    action?: string;
    evidenceConfidence?: number;
    highRiskRollback?: boolean;
  };
}

export interface PsycheOutcomeResult {
  at: string;
  consultAuditID: string;
  reward: 'positive' | 'negative';
  score: number;
  bucket: string;
}

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

function asUrgency(value: unknown): PsycheUrgency {
  return value === 'low' || value === 'high' || value === 'critical' ? value : 'medium';
}

export class PsycheConsultService {
  private readonly fastBrainPath: string;
  private readonly consultLogPath: string;
  private readonly budgetPath: string;
  private readonly probeBudgetPath: string;
  private readonly trainingDataLogPath: string;
  private readonly trustPath: string;
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
    this.probeBudgetPath = path.join(psycheDir, 'probe-budget.json');
    this.trainingDataLogPath = path.join(psycheDir, 'training-data.jsonl');
    this.trustPath = path.join(psycheDir, 'trust-score.json');
    this.epsilon = Math.max(0, Math.min(0.1, options?.epsilon ?? this.resolveEpsilonFromEnv()));
    this.random = options?.random ?? defaultRandomSource;
  }

  consult(input: PsycheConsultRequest): PsycheConsultResult {
    const intent = String(input.intent ?? '').trim() || 'unknown_intent';
    const urgency = asUrgency(input.urgency);
    const userInitiated = input.userInitiated !== false;
    const sentinel = inferSentinelState(input.signals);
    const needsProbe = sentinel.shouldProbeScreen;
    const probeBudget = needsProbe
      ? consumeProbeBudget(this.probeBudgetPath, this.probeBudgetConfig())
      : { allowed: false, remainingTokens: 0 };
    const shouldProbeScreen = needsProbe && probeBudget.allowed;
    const state = sentinel.state;
    const auditID = randomUUID();
    const at = nowIso();

    const fastBrainScore = readFastBrainScore(this.fastBrainPath, {
      state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
    });
    const trustTarget = getTrustScore(this.trustPath, { kind: 'target', value: input.trust?.target });
    const trustSource = getTrustScore(this.trustPath, { kind: 'source', value: input.trust?.source });
    const trustAction = getTrustScore(this.trustPath, { kind: 'action', value: input.trust?.action });
    const minTrust = Math.min(trustTarget, trustSource, trustAction);
    const trustTier = trustTierFromScore(minTrust);

    const decisionSeed = this.pickDecision({
      state,
      urgency,
      intent,
      userInitiated,
      shouldProbeScreen: needsProbe,
      fastBrainScore,
      trustTier,
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
        needsProbe && !shouldProbeScreen ? 'probe_rate_limited' : '',
        `fast_brain_score=${fastBrainScore.toFixed(2)}`,
        budgetHint,
        explorationApplied ? 'epsilon_exploration' : '',
      ].filter((item) => item.length > 0),
    });
    const fixability = this.resolveFixability({
      decision,
      state,
      reasons: [
        ...sentinel.reasons,
        needsProbe && !shouldProbeScreen ? 'probe_rate_limited' : '',
      ].filter((item) => item.length > 0),
      trustTier,
      userInitiated,
    });
    const approvalMode = this.resolveApprovalMode({
      decision,
      urgency,
      trustTier,
    });
    const budget = this.resolveNegotiationBudget(fixability);
    const insightText = this.buildInsightText({
      decision,
      state,
      trustTier,
      approvalMode,
      fixability,
      shouldProbeScreen,
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
      shouldProbeScreen,
      reasons: [
        ...sentinel.reasons,
        needsProbe && !shouldProbeScreen ? 'probe_rate_limited' : '',
      ].filter((item) => item.length > 0),
      approvalMode,
      fixability,
      budget,
      trust: {
        target: trustTarget,
        source: trustSource,
        action: trustAction,
        minScore: minTrust,
        tier: trustTier,
      },
      insightText,
    };

    touchFastBrain(this.fastBrainPath, {
      state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
      approved: decision === 'allow',
    });
    this.appendConsultLog(result);
    appendPsycheObservation(this.trainingDataLogPath, {
      at,
      state,
      intent,
      urgency,
      channel: input.channel,
      userInitiated,
      confidence: sentinel.confidence,
      decision,
      shouldProbeScreen,
      reasons: result.reasons,
      signals: input.signals,
      approvalMode: result.approvalMode,
      fixability: result.fixability,
      trust: result.trust,
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
    adjustFastBrain(
      this.fastBrainPath,
      key,
      reward === 'positive' ? Math.abs(score) : 0,
      reward === 'negative' ? Math.abs(score) : 0,
    );
    appendPsycheOutcome(this.trainingDataLogPath, {
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
    const approved = input.delivered && feedback !== 'negative';
    const confidence = Number.isFinite(input.trust?.evidenceConfidence)
      ? Number(input.trust?.evidenceConfidence)
      : typeof input.userReplyWithinSec === 'number' && input.userReplyWithinSec > 0
        ? 0.9
        : 0.7;
    if (input.trust?.target) {
      updateTrustScore(this.trustPath, {
        kind: 'target',
        value: input.trust.target,
        approved,
        confidence,
        highRiskRollback: input.trust.highRiskRollback,
      });
    }
    if (input.trust?.source) {
      updateTrustScore(this.trustPath, {
        kind: 'source',
        value: input.trust.source,
        approved,
        confidence,
        highRiskRollback: input.trust.highRiskRollback,
      });
    }
    if (input.trust?.action) {
      updateTrustScore(this.trustPath, {
        kind: 'action',
        value: input.trust.action,
        approved,
        confidence,
        highRiskRollback: input.trust.highRiskRollback,
      });
    }
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
    trustTier: TrustTier;
  }): PsycheDecision {
    const { state, urgency, userInitiated, shouldProbeScreen, fastBrainScore, trustTier } = input;
    if (userInitiated) {
      if (state === 'UNKNOWN' && urgency === 'low') return 'defer';
      if (trustTier === 'low' && urgency === 'low') return 'defer';
      return 'allow';
    }

    if (shouldProbeScreen && urgency !== 'critical') return 'defer';
    if (trustTier === 'low' && urgency !== 'critical') return 'deny';
    if (urgency === 'critical') return 'allow';
    if (state === 'FOCUS' || state === 'PLAY' || state === 'UNKNOWN') return 'defer';
    if (state === 'CONSUME') {
      if (urgency === 'high') return fastBrainScore >= 0.35 ? 'allow' : 'defer';
      return fastBrainScore >= 0.6 ? 'allow' : 'defer';
    }
    return fastBrainScore >= 0.3 ? 'allow' : 'defer';
  }

  private resolveFixability(input: {
    decision: PsycheDecision;
    state: SentinelState;
    reasons: string[];
    trustTier: TrustTier;
    userInitiated: boolean;
  }): PsycheFixability {
    if (input.decision === 'deny') {
      if (input.trustTier === 'low' && !input.userInitiated) return 'impossible';
      return 'reduce_scope';
    }
    if (input.reasons.some((item) => item.includes('probe'))) {
      return 'need_evidence';
    }
    if (input.state === 'FOCUS' || input.state === 'PLAY' || input.state === 'UNKNOWN') {
      return 'retry_later';
    }
    return 'rewrite';
  }

  private resolveApprovalMode(input: {
    decision: PsycheDecision;
    urgency: PsycheUrgency;
    trustTier: TrustTier;
  }): PsycheApprovalMode {
    if (input.decision !== 'allow') return 'modal_approval';
    if (input.trustTier === 'high' && input.urgency === 'low') return 'silent_audit';
    if (input.trustTier === 'low' || input.urgency === 'high' || input.urgency === 'critical') {
      return 'modal_approval';
    }
    return 'toast_gate';
  }

  private resolveNegotiationBudget(fixability: PsycheFixability): {
    autoRetry: number;
    humanEdit: number;
  } {
    if (fixability === 'impossible') return { autoRetry: 0, humanEdit: 0 };
    if (fixability === 'retry_later') return { autoRetry: 1, humanEdit: 0 };
    return { autoRetry: 1, humanEdit: 1 };
  }

  private buildInsightText(input: {
    decision: PsycheDecision;
    state: SentinelState;
    trustTier: TrustTier;
    approvalMode: PsycheApprovalMode;
    fixability: PsycheFixability;
    shouldProbeScreen: boolean;
  }): string {
    const parts = [
      `state=${input.state}`,
      `trust=${input.trustTier}`,
      `decision=${input.decision}`,
      `gate=${input.approvalMode}`,
      `fix=${input.fixability}`,
    ];
    if (input.shouldProbeScreen) parts.push('probe=required');
    return `Psyche: ${parts.join(' | ')}`;
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

  private appendConsultLog(result: PsycheConsultResult): void {
    fs.appendFileSync(this.consultLogPath, `${JSON.stringify(result)}\n`, 'utf-8');
  }

  private probeBudgetConfig(): { capacity: number; refillPerSec: number } {
    const capacityRaw = Number(process.env.MIYA_PSYCHE_PROBE_BUCKET_CAPACITY ?? 2);
    const windowSecRaw = Number(process.env.MIYA_PSYCHE_PROBE_BUCKET_WINDOW_SEC ?? 60);
    const capacity = Number.isFinite(capacityRaw) ? Math.max(1, Math.floor(capacityRaw)) : 2;
    const windowSec = Number.isFinite(windowSecRaw) ? Math.max(1, windowSecRaw) : 60;
    return {
      capacity,
      refillPerSec: capacity / windowSec,
    };
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
    const store = this.readBudgetStore();
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

  private readBudgetStore(): InterruptionBudgetStore {
    if (!fs.existsSync(this.budgetPath)) return { byState: {} };
    try {
      return JSON.parse(fs.readFileSync(this.budgetPath, 'utf-8')) as InterruptionBudgetStore;
    } catch {
      return { byState: {} };
    }
  }
}
