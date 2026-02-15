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
  allowScreenProbe?: boolean;
  signals?: SentinelSignals;
  captureLimitations?: string[];
  trust?: {
    target?: string;
    source?: string;
    action?: string;
    evidenceConfidence?: number;
  };
}

export type PsycheApprovalMode = 'silent_audit' | 'toast_gate' | 'modal_approval';
export type PsycheFixability = 'impossible' | 'rewrite' | 'reduce_scope' | 'need_evidence' | 'retry_later';

export interface PsycheRiskSummary {
  falseIdleUncertain: boolean;
  drmCaptureBlocked: boolean;
  probeRateLimited: boolean;
  probeRequested: boolean;
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
  allowed: boolean;
  reason: string;
  nextCheckSec: number;
  // Legacy compatibility field used by older gateway callers.
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
  risk: PsycheRiskSummary;
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
  userInitiatedWithinSec?: number;
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

interface PsycheLifecycleState {
  firstSeenAt: string;
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
  private readonly lifecyclePath: string;
  private readonly epsilon: number;
  private readonly shadowModeDays: number;
  private readonly random: RandomSource;
  private readonly delayedPenaltyApplied = new Set<string>();

  constructor(
    private readonly projectDir: string,
    options?: {
      epsilon?: number;
      shadowModeDays?: number;
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
    this.lifecyclePath = path.join(psycheDir, 'lifecycle.json');
    this.epsilon = Math.max(0, Math.min(0.1, options?.epsilon ?? this.resolveEpsilonFromEnv()));
    this.shadowModeDays = this.resolveShadowModeDays(options?.shadowModeDays);
    this.random = options?.random ?? defaultRandomSource;
    this.ensureLifecycleState();
  }

  consult(input: PsycheConsultRequest): PsycheConsultResult {
    const intent = String(input.intent ?? '').trim() || 'unknown_intent';
    const urgency = asUrgency(input.urgency);
    const userInitiated = input.userInitiated !== false;
    const captureLimitations = this.normalizeCaptureLimitations(
      input.captureLimitations ?? input.signals?.captureLimitations,
    );
    const sentinel = inferSentinelState({
      ...(input.signals ?? {}),
      captureLimitations,
    });
    const probeEnabled = input.allowScreenProbe !== false;
    const needsProbe = sentinel.shouldProbeScreen && probeEnabled;
    const probeBudget = needsProbe
      ? consumeProbeBudget(this.probeBudgetPath, this.probeBudgetConfig())
      : { allowed: false, remainingTokens: 0 };
    const shouldProbeScreen = needsProbe && probeBudget.allowed;
    const state = sentinel.state;
    const auditID = randomUUID();
    const at = nowIso();
    const shadowModeActive = this.isShadowModeActive();

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
    let shadowModeApplied = false;
    if (!userInitiated && shadowModeActive && urgency !== 'critical') {
      decision = 'defer';
      shadowModeApplied = true;
    }
    let budgetHint = '';
    if (!userInitiated) {
      const budget = this.applyInterruptionBudget(state, decision === 'allow');
      if (decision === 'allow' && budget.blocked) {
        decision = 'defer';
        budgetHint = `budget_exhausted:${state}`;
      }
    }

    let explorationApplied = false;
    if (!userInitiated && decision === 'defer' && !shadowModeApplied && this.shouldExplore()) {
      decision = 'allow';
      explorationApplied = true;
    }

    const reasonMarkers = [
      ...sentinel.reasons,
      sentinel.shouldProbeScreen && !probeEnabled ? 'probe_disabled' : '',
      needsProbe && !shouldProbeScreen ? 'probe_rate_limited' : '',
      `fast_brain_score=${fastBrainScore.toFixed(2)}`,
      budgetHint,
      explorationApplied ? 'epsilon_exploration' : '',
      shadowModeApplied ? 'shadow_mode_safe_hold' : '',
    ].filter((item) => item.length > 0);

    const risk = this.resolveRisk({
      state,
      reasons: reasonMarkers,
      needsProbe,
      shouldProbeScreen,
      captureLimitations,
    });
    const nextCheckSec = this.resolveNextCheckSec({
      decision,
      urgency,
      state,
      shadowModeApplied,
      risk,
    });
    const reason = this.buildReason({
      decision,
      state,
      userInitiated,
      urgency,
      intent,
      reasons: reasonMarkers,
    });
    const fixability = this.resolveFixability({
      decision,
      state,
      reasons: reasonMarkers,
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
      risk,
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
      allowed: decision === 'allow',
      reason,
      nextCheckSec,
      retryAfterSec: nextCheckSec,
      shouldProbeScreen,
      reasons: reasonMarkers,
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
      risk,
      insightText,
    };

    if (userInitiated && !input.trust?.action?.startsWith('daemon.')) {
      this.applyMissedOpportunityPenalty({
        at,
        state,
        intent,
        urgency,
        channel: input.channel,
        consultAuditID: auditID,
      });
    }

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
      signals: {
        ...(input.signals ?? {}),
        captureLimitations,
      },
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
      userInitiatedWithinSec: input.userInitiatedWithinSec,
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
      userInitiatedWithinSec: input.userInitiatedWithinSec,
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
    if (fixability === 'retry_later') return { autoRetry: 1, humanEdit: 1 };
    return { autoRetry: 1, humanEdit: 1 };
  }

  private buildInsightText(input: {
    decision: PsycheDecision;
    state: SentinelState;
    trustTier: TrustTier;
    approvalMode: PsycheApprovalMode;
    fixability: PsycheFixability;
    shouldProbeScreen: boolean;
    risk: PsycheRiskSummary;
  }): string {
    const parts = [
      `state=${input.state}`,
      `trust=${input.trustTier}`,
      `decision=${input.decision}`,
      `gate=${input.approvalMode}`,
      `fix=${input.fixability}`,
    ];
    if (input.shouldProbeScreen) parts.push('probe=required');
    if (input.risk.falseIdleUncertain) parts.push('risk=false_idle');
    if (input.risk.drmCaptureBlocked) parts.push('risk=drm_capture');
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

  private resolveShadowModeDays(override?: number): number {
    const raw = Number(
      override ?? process.env.MIYA_PSYCHE_SHADOW_MODE_DAYS ?? process.env.MIYA_PSYCHE_COLDSTART_DAYS ?? 7,
    );
    if (!Number.isFinite(raw)) return 7;
    return Math.max(0, Math.min(30, Math.floor(raw)));
  }

  private ensureLifecycleState(): void {
    if (fs.existsSync(this.lifecyclePath)) return;
    const seed: PsycheLifecycleState = { firstSeenAt: nowIso() };
    fs.writeFileSync(this.lifecyclePath, `${JSON.stringify(seed, null, 2)}\n`, 'utf-8');
  }

  private readLifecycleState(): PsycheLifecycleState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.lifecyclePath, 'utf-8')) as Partial<PsycheLifecycleState>;
      const firstSeenAt = typeof parsed.firstSeenAt === 'string' ? parsed.firstSeenAt : nowIso();
      return { firstSeenAt };
    } catch {
      const fallback: PsycheLifecycleState = { firstSeenAt: nowIso() };
      fs.writeFileSync(this.lifecyclePath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8');
      return fallback;
    }
  }

  private isShadowModeActive(nowMs = Date.now()): boolean {
    if (this.shadowModeDays <= 0) return false;
    const lifecycle = this.readLifecycleState();
    const firstSeenAtMs = Date.parse(lifecycle.firstSeenAt);
    if (!Number.isFinite(firstSeenAtMs)) return false;
    return nowMs - firstSeenAtMs < this.shadowModeDays * 24 * 3600 * 1000;
  }

  private normalizeCaptureLimitations(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter((item) => item.length > 0)
      .slice(0, 12);
  }

  private resolveRisk(input: {
    state: SentinelState;
    reasons: string[];
    needsProbe: boolean;
    shouldProbeScreen: boolean;
    captureLimitations: string[];
  }): PsycheRiskSummary {
    const reasonSet = new Set(input.reasons);
    const drmCaptureBlocked =
      reasonSet.has('screen_probe_capture_protected') ||
      input.captureLimitations.some((item) =>
        ['drm', 'hdcp', 'protected', 'pmp'].some((flag) => item.includes(flag)),
      );
    const falseIdleUncertain =
      input.state === 'UNKNOWN' ||
      reasonSet.has('input_signal_conflict') ||
      reasonSet.has('idle_with_media_signal_needs_probe') ||
      reasonSet.has('probe_failed_with_media_signals') ||
      reasonSet.has('probe_failed_fallback_unknown');
    const probeRateLimited = input.needsProbe && !input.shouldProbeScreen;
    return {
      falseIdleUncertain,
      drmCaptureBlocked,
      probeRateLimited,
      probeRequested: input.needsProbe,
    };
  }

  private resolveNextCheckSec(input: {
    decision: PsycheDecision;
    urgency: PsycheUrgency;
    state: SentinelState;
    shadowModeApplied: boolean;
    risk: PsycheRiskSummary;
  }): number {
    if (input.decision === 'allow') return 0;
    if (input.shadowModeApplied) return 120;
    if (input.urgency === 'critical') return input.risk.falseIdleUncertain ? 20 : 10;
    let base = 90;
    if (input.state === 'FOCUS' || input.state === 'PLAY') base = 300;
    else if (input.state === 'UNKNOWN') base = 180;
    else if (input.state === 'CONSUME') base = 120;
    if (input.risk.probeRateLimited) base += 60;
    return Math.max(15, Math.min(900, base));
  }

  private applyMissedOpportunityPenalty(input: {
    at: string;
    state: SentinelState;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    consultAuditID: string;
  }): void {
    const recent = this.findRecentDeferredConsult(input);
    if (!recent) return;
    if (this.delayedPenaltyApplied.has(recent.auditID)) return;
    this.delayedPenaltyApplied.add(recent.auditID);
    const initiatedAtMs = Date.parse(input.at);
    const deferredAtMs = Date.parse(recent.at);
    const initiatedWithinSec =
      Number.isFinite(initiatedAtMs) && Number.isFinite(deferredAtMs)
        ? Math.max(0, Math.floor((initiatedAtMs - deferredAtMs) / 1000))
        : undefined;
    const missedScore = -0.25;
    const key = fastBrainBucket({
      state: recent.state,
      intent: recent.intent,
      urgency: recent.urgency,
      channel: recent.channel,
      userInitiated: false,
    });
    adjustFastBrain(this.fastBrainPath, key, 0, Math.abs(missedScore));
    appendPsycheOutcome(this.trainingDataLogPath, {
      at: input.at,
      consultAuditID: recent.auditID,
      state: recent.state,
      intent: recent.intent,
      urgency: recent.urgency,
      channel: recent.channel,
      userInitiated: false,
      delivered: false,
      blockedReason: 'missed_opportunity_user_initiated',
      explicitFeedback: 'none',
      userReplyWithinSec: undefined,
      userInitiatedWithinSec: initiatedWithinSec,
      score: missedScore,
      reward: 'negative',
    });
  }

  private findRecentDeferredConsult(input: {
    at: string;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    consultAuditID: string;
  }): {
    auditID: string;
    at: string;
    intent: string;
    urgency: PsycheUrgency;
    channel?: string;
    state: SentinelState;
  } | null {
    if (!fs.existsSync(this.consultLogPath)) return null;
    const nowMs = Date.parse(input.at);
    const lines = fs.readFileSync(this.consultLogPath, 'utf-8').trim().split(/\r?\n/);
    const recentLines = lines.slice(-120).reverse();
    for (const line of recentLines) {
      try {
        const row = JSON.parse(line) as Partial<PsycheConsultResult>;
        if (!row || row.auditID === input.consultAuditID) continue;
        if (row.userInitiated !== false) continue;
        if (row.decision !== 'defer') continue;
        if (row.state !== 'FOCUS' && row.state !== 'PLAY' && row.state !== 'UNKNOWN') continue;
        const rowChannel = typeof row.channel === 'string' ? row.channel : undefined;
        if (input.channel && rowChannel && input.channel !== rowChannel) continue;
        if (typeof row.at !== 'string') continue;
        const rowMs = Date.parse(row.at);
        if (!Number.isFinite(rowMs) || !Number.isFinite(nowMs)) continue;
        const deltaSec = (nowMs - rowMs) / 1000;
        if (deltaSec < 0 || deltaSec > 300) continue;
        return {
          auditID: String(row.auditID),
          at: row.at,
          intent: String(row.intent ?? input.intent),
          urgency: asUrgency(row.urgency),
          channel: rowChannel,
          state: row.state,
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  private outcomeScore(input: {
    delivered: boolean;
    blockedReason?: string;
    explicitFeedback: 'positive' | 'negative' | 'none';
    userReplyWithinSec?: number;
    userInitiatedWithinSec?: number;
  }): number {
    if (input.explicitFeedback === 'negative') return -1;
    if (input.explicitFeedback === 'positive') return 1;
    if (!input.delivered) {
      const blockedReason = String(input.blockedReason ?? '').toLowerCase();
      const userInitiatedWithinSec = Number(input.userInitiatedWithinSec ?? Number.NaN);
      if (Number.isFinite(userInitiatedWithinSec) && userInitiatedWithinSec > 0 && userInitiatedWithinSec <= 300) {
        return -0.25;
      }
      if (blockedReason.includes('psyche_deferred') || blockedReason.includes('safe_hold')) {
        return 0.2;
      }
      return blockedReason ? -0.5 : -0.3;
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
